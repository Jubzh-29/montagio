import type { VideoTags } from '@montagio/sequence/tags';

/** What the montage is doing: fetching FFmpeg (31 MB, once), then joining the clips. */
export type MontageStage = 'loading-ffmpeg' | 'joining';

/** Clips to join, as URLs, with the tags the film carries. */
export type MontageJob = { clips: string[]; verticals: string[]; tags: VideoTags };

/** Joins a film and its 9:16 cut in the browser (ffmpeg.wasm, see montage.ts). */
export type Montage = {
  /** Start fetching FFmpeg ahead of the first film; safe to call many times. */
  preload(): void;
  assemble(job: MontageJob, signal: AbortSignal, onStage: (stage: MontageStage) => void): Promise<{ film: Blob; vertical: Blob }>;
};

export type MontageErrorCode = 'ffmpeg-unavailable' | 'ffmpeg-failed' | 'canceled';

export class MontageError extends Error {
  override name = 'MontageError';
  constructor(readonly code: MontageErrorCode) {
    super(code);
  }
}
