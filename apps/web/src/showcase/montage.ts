import type { FFmpeg as FFmpegClass } from '@ffmpeg/ffmpeg';
import type { VideoTags } from '@montagio/sequence/tags';
import { concatArgs } from './montage-args';
import { MontageError, type Montage } from './types';
import { ffmpegUrl } from './urls';

/** The part of ffmpeg.wasm's FFmpeg class the montage uses (a fake one stands in for tests). */
export type FFmpegLike = {
  writeFile(name: string, data: Uint8Array | string): Promise<unknown>;
  exec(args: string[]): Promise<number>;
  readFile(name: string): Promise<Uint8Array | string>;
  deleteFile(name: string): Promise<unknown>;
  terminate(): void;
};

/** Long enough for 31 MB on a slow connection (about 2 Mbit/s), short enough not to hang a juror. */
const LOAD_TIMEOUT_MS = 120_000;

/** Rejects with MontageError('canceled') as soon as `signal` aborts. */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MontageError('canceled'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Join a film and its 9:16 cut in the browser. FFmpeg (31 MB of WebAssembly)
 * is loaded once and kept; every virtual file a film needed is deleted once
 * its blobs are out; a canceled montage terminates FFmpeg, and the next one
 * loads a fresh instance.
 *
 * ffmpeg.wasm only listens to its worker's messages: a worker that cannot start
 * (blocked, missing, a browser without module workers) never answers. A load that
 * has not finished after `loadTimeoutMs` fails as ffmpeg-unavailable, and an
 * instance that turns up later is terminated.
 */
export function createMontage(deps: {
  load: (signal: AbortSignal) => Promise<FFmpegLike>;
  fetchBytes: (url: string) => Promise<Uint8Array>;
  loadTimeoutMs?: number;
}): Montage {
  const timeoutMs = deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
  let instance: Promise<FFmpegLike> | null = null;
  let loaded = false;

  const loadOnce = (): Promise<FFmpegLike> => {
    if (!instance) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const loading = deps.load(controller.signal);
      // Too late: nobody waits for this instance any more.
      loading.then((ffmpeg) => controller.signal.aborted && ffmpeg.terminate(), () => undefined);
      const timedOut = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error(`FFmpeg did not load in ${timeoutMs} ms`)), { once: true }),
      );
      const attempt: Promise<FFmpegLike> = Promise.race([loading, timedOut])
        .finally(() => clearTimeout(timer))
        .then(
          (ffmpeg) => {
            if (instance === attempt) loaded = true;
            return ffmpeg;
          },
          (error: unknown) => {
            console.error('[montagio] FFmpeg could not be loaded', error);
            controller.abort();
            if (instance === attempt) instance = null;
            throw new MontageError('ffmpeg-unavailable');
          },
        );
      instance = attempt;
    }
    return instance;
  };

  const forget = () => {
    instance = null;
    loaded = false;
  };

  async function join(ffmpeg: FFmpegLike, urls: string[], prefix: string, out: string, tags: VideoTags, written: string[]): Promise<Blob> {
    const names = urls.map((_, index) => `${prefix}${index}.mp4`);
    for (const [index, url] of urls.entries()) {
      const bytes = await deps.fetchBytes(url);
      written.push(names[index]!);
      await ffmpeg.writeFile(names[index]!, bytes);
    }
    const list = `${prefix}-list.txt`;
    written.push(list, out);
    await ffmpeg.writeFile(list, names.map((name) => `file '${name}'\n`).join(''));
    const code = await ffmpeg.exec(concatArgs(list, out, tags));
    if (code !== 0) throw new MontageError('ffmpeg-failed');
    const data = await ffmpeg.readFile(out);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    return new Blob([bytes], { type: 'video/mp4' });
  }

  return {
    preload() {
      loadOnce().catch(() => undefined);
    },

    async assemble(job, signal, onStage) {
      if (!loaded) onStage('loading-ffmpeg');
      const ffmpeg = await unlessAborted(loadOnce(), signal);
      onStage('joining');
      const written: string[] = [];
      // FFmpeg cannot stop one command: terminating the instance is the only way, then it is gone.
      const onAbort = () => {
        forget();
        ffmpeg.terminate();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const film = await join(ffmpeg, job.clips, 'c', 'film.mp4', job.tags, written);
        const vertical = await join(ffmpeg, job.verticals, 'v', 'film-9x16.mp4', job.tags, written);
        return { film, vertical };
      } catch (error) {
        if (signal.aborted) throw new MontageError('canceled');
        console.error('[montagio] the film could not be assembled', error);
        throw error instanceof MontageError ? error : new MontageError('ffmpeg-failed');
      } finally {
        signal.removeEventListener('abort', onAbort);
        // A terminated instance holds no file any more; a live one gets its memory back.
        if (!signal.aborted) for (const name of written) await ffmpeg.deleteFile(name).catch(() => undefined);
      }
    },
  };
}

/**
 * The montage of the showcase page. ffmpeg.wasm is not bundled (Turbopack cannot
 * resolve its worker URL): its files are copied to /ffmpeg by the showcase build
 * and imported from there at run time, never from a CDN.
 */
export function browserMontage(): Montage {
  const absolute = (path: string) => new URL(path, window.location.href).href;
  return createMontage({
    load: async (signal) => {
      const { FFmpeg } = (await import(/* webpackIgnore: true */ absolute(ffmpegUrl('esm/index.js')))) as { FFmpeg: typeof FFmpegClass };
      const ffmpeg = new FFmpeg();
      try {
        await ffmpeg.load(
          {
            coreURL: absolute(ffmpegUrl('ffmpeg-core.js')),
            wasmURL: absolute(ffmpegUrl('ffmpeg-core.wasm')),
            classWorkerURL: absolute(ffmpegUrl('esm/worker.js')),
          },
          { signal },
        );
      } catch (error) {
        // Do not leave a worker running for an instance nobody will use.
        ffmpeg.terminate();
        throw error;
      }
      return ffmpeg;
    },
    fetchBytes: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  });
}
