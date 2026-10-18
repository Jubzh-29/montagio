import { AI_METADATA } from '@montagio/sequence/tags';
import { createMontage, type FFmpegLike } from '@/showcase/montage';
import { concatArgs } from '@/showcase/montage-args';
import { MontageError, type MontageJob, type MontageStage } from '@/showcase/types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const job: MontageJob = { clips: ['/s/a.mp4', '/s/b.mp4'], verticals: ['/s/a.9x16.mp4', '/s/b.9x16.mp4'], tags: AI_METADATA };
const bytesOf = (url: string) => new TextEncoder().encode(url);

/** An FFmpeg that keeps its virtual files in a Map; exec writes a 3-byte output. */
function fakeFFmpeg(opts: { execCode?: number; hangExec?: boolean } = {}) {
  const files = new Map<string, Uint8Array | string>();
  const execs: string[][] = [];
  let terminated = 0;
  let pending: ((error: Error) => void) | null = null;
  const ffmpeg: FFmpegLike = {
    writeFile: async (name, data) => {
      files.set(name, data);
      return true;
    },
    exec: (args) => {
      execs.push(args);
      if (opts.hangExec) return new Promise<number>((_, reject) => (pending = reject));
      files.set(args.at(-1)!, new Uint8Array([1, 2, 3]));
      return Promise.resolve(opts.execCode ?? 0);
    },
    readFile: async (name) => {
      const file = files.get(name);
      if (file === undefined) throw new Error(`no ${name}`);
      return file;
    },
    deleteFile: async (name) => files.delete(name),
    terminate: () => {
      terminated += 1;
      pending?.(new Error('called FFmpeg.terminate()'));
    },
  };
  return { ffmpeg, files, execs, terminated: () => terminated };
}

const fetchBytes = async (url: string) => bytesOf(url);

test('preload loads FFmpeg once', async () => {
  const fake = fakeFFmpeg();
  const load = vi.fn(async () => fake.ffmpeg);
  const montage = createMontage({ load, fetchBytes });
  montage.preload();
  montage.preload();
  await flush();
  await montage.assemble(job, new AbortController().signal, () => undefined);
  expect(load).toHaveBeenCalledTimes(1);
});

test('assemble writes the clips, runs the two concats and returns two mp4 blobs', async () => {
  const fake = fakeFFmpeg();
  const written: [string, Uint8Array | string][] = [];
  const spy = fake.ffmpeg.writeFile;
  fake.ffmpeg.writeFile = async (name, data) => {
    written.push([name, data]);
    return spy(name, data);
  };
  const montage = createMontage({ load: async () => fake.ffmpeg, fetchBytes });
  const { film, vertical } = await montage.assemble(job, new AbortController().signal, () => undefined);
  expect(film.type).toBe('video/mp4');
  expect(vertical.type).toBe('video/mp4');
  expect(film.size).toBe(3);
  expect(fake.execs).toEqual([concatArgs('c-list.txt', 'film.mp4', AI_METADATA), concatArgs('v-list.txt', 'film-9x16.mp4', AI_METADATA)]);
  expect(written).toContainEqual(['c0.mp4', bytesOf('/s/a.mp4')]);
  expect(written).toContainEqual(['c1.mp4', bytesOf('/s/b.mp4')]);
  expect(written).toContainEqual(['v1.mp4', bytesOf('/s/b.9x16.mp4')]);
  expect(written).toContainEqual(['c-list.txt', "file 'c0.mp4'\nfile 'c1.mp4'\n"]);
  // Nothing stays in FFmpeg's memory once the blobs are out.
  expect(fake.files.size).toBe(0);
});

test('assemble deletes every virtual file, even when exec fails', async () => {
  const fake = fakeFFmpeg({ execCode: 1 });
  const montage = createMontage({ load: async () => fake.ffmpeg, fetchBytes });
  const error = await montage.assemble(job, new AbortController().signal, () => undefined).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MontageError);
  expect((error as MontageError).code).toBe('ffmpeg-failed');
  expect(fake.files.size).toBe(0);
});

test('a failed load is ffmpeg-unavailable and the next call loads again', async () => {
  const fake = fakeFFmpeg();
  let attempts = 0;
  const montage = createMontage({
    load: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('wasm blocked');
      return fake.ffmpeg;
    },
    fetchBytes,
  });
  const error = await montage.assemble(job, new AbortController().signal, () => undefined).catch((e: unknown) => e);
  expect((error as MontageError).code).toBe('ffmpeg-unavailable');
  await expect(montage.assemble(job, new AbortController().signal, () => undefined)).resolves.toBeDefined();
  expect(attempts).toBe(2);
});

test('abort terminates FFmpeg, ends canceled, and the next montage loads a new instance', async () => {
  const hanging = fakeFFmpeg({ hangExec: true });
  const fresh = fakeFFmpeg();
  const load = vi.fn().mockResolvedValueOnce(hanging.ffmpeg).mockResolvedValueOnce(fresh.ffmpeg);
  const montage = createMontage({ load, fetchBytes });
  const controller = new AbortController();
  const running = montage.assemble(job, controller.signal, () => undefined).catch((e: unknown) => e);
  while (hanging.execs.length === 0) await flush();
  controller.abort();
  const error = await running;
  expect((error as MontageError).code).toBe('canceled');
  expect(hanging.terminated()).toBe(1);
  await expect(montage.assemble(job, new AbortController().signal, () => undefined)).resolves.toBeDefined();
  expect(load).toHaveBeenCalledTimes(2);
});

test('reports loading-ffmpeg then joining', async () => {
  const fake = fakeFFmpeg();
  const montage = createMontage({ load: async () => fake.ffmpeg, fetchBytes });
  const first: MontageStage[] = [];
  await montage.assemble(job, new AbortController().signal, (stage) => first.push(stage));
  expect(first).toEqual(['loading-ffmpeg', 'joining']);
  const second: MontageStage[] = [];
  await montage.assemble(job, new AbortController().signal, (stage) => second.push(stage));
  // FFmpeg is already loaded: straight to joining.
  expect(second).toEqual(['joining']);
});

test('a clip that cannot be fetched fails the film', async () => {
  const fake = fakeFFmpeg();
  const montage = createMontage({
    load: async () => fake.ffmpeg,
    fetchBytes: async (url) => {
      if (url.endsWith('b.mp4')) throw new Error('HTTP 404');
      return bytesOf(url);
    },
  });
  const error = await montage.assemble(job, new AbortController().signal, () => undefined).catch((e: unknown) => e);
  expect((error as MontageError).code).toBe('ffmpeg-failed');
  expect(fake.files.size).toBe(0);
});

test('a load that never settles fails as ffmpeg-unavailable after the timeout, and the next film loads again', async () => {
  // ffmpeg.wasm only listens to its worker's messages: a worker that fails to start never answers.
  const fake = fakeFFmpeg();
  const signals: AbortSignal[] = [];
  let attempts = 0;
  const montage = createMontage({
    load: (signal) => {
      signals.push(signal);
      attempts += 1;
      return attempts === 1 ? new Promise<FFmpegLike>(() => undefined) : Promise.resolve(fake.ffmpeg);
    },
    fetchBytes,
    loadTimeoutMs: 20,
  });
  const error = await montage.assemble(job, new AbortController().signal, () => undefined).catch((e: unknown) => e);
  expect((error as MontageError).code).toBe('ffmpeg-unavailable');
  expect(signals[0]!.aborted).toBe(true);
  await expect(montage.assemble(job, new AbortController().signal, () => undefined)).resolves.toBeDefined();
  expect(attempts).toBe(2);
});

test('an instance that loads after its timeout is terminated', async () => {
  const late = fakeFFmpeg();
  const montage = createMontage({
    load: () => new Promise<FFmpegLike>((resolve) => setTimeout(() => resolve(late.ffmpeg), 60)),
    fetchBytes,
    loadTimeoutMs: 20,
  });
  const error = await montage.assemble(job, new AbortController().signal, () => undefined).catch((e: unknown) => e);
  expect((error as MontageError).code).toBe('ffmpeg-unavailable');
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(late.terminated()).toBe(1);
});
