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
 */
export function createMontage(deps: { load: () => Promise<FFmpegLike>; fetchBytes: (url: string) => Promise<Uint8Array> }): Montage {
  let instance: Promise<FFmpegLike> | null = null;
  let loaded = false;

  const loadOnce = (): Promise<FFmpegLike> => {
    if (!instance) {
      const attempt: Promise<FFmpegLike> = deps.load().then(
        (ffmpeg) => {
          if (instance === attempt) loaded = true;
          return ffmpeg;
        },
        (error: unknown) => {
          console.error('[montagio] FFmpeg could not be loaded', error);
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
    load: async () => {
      const { FFmpeg } = (await import(/* webpackIgnore: true */ absolute(ffmpegUrl('esm/index.js')))) as { FFmpeg: typeof FFmpegClass };
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: absolute(ffmpegUrl('ffmpeg-core.js')),
        wasmURL: absolute(ffmpegUrl('ffmpeg-core.wasm')),
        classWorkerURL: absolute(ffmpegUrl('esm/worker.js')),
      });
      return ffmpeg;
    },
    fetchBytes: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  });
}
