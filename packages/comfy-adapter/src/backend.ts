import type { ApiWorkflow } from '@montagio/presets';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type BackendJob = {
  id: string;
  state: JobState;
  /** 0..1 */
  progress: number;
  previewPath?: string;
  outputPath?: string;
  error?: string;
};

export type BackendKind = 'demo' | 'local' | 'hosted';

/** What a job delivers: a clip (camera presets, upscale, avatar), a soundtrack or speech, or a still. */
export const OUTPUT_KINDS = ['video', 'audio', 'image', 'file'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Which output of a finished job is its result: the first of `output` (default "video"), from `outputNode` first when given. */
export type OutputWanted = { output?: OutputKind; outputNode?: string };

/**
 * How long an idempotency key holds: the web layer replays a request whose key it saw
 * less than this ago, and a backend remembers the job a key started for as long.
 */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/** A compiled workflow to run, plus the local files its loader nodes need (the start image). */
export type SubmitJob = {
  workflow: ApiWorkflow;
  presetId: string;
  idempotencyKey: string;
  files?: { node: string; field: string; path: string }[];
  /** The kind of output the job delivers (default "video"). */
  output?: OutputKind;
  /** The node whose output is the result, when the workflow may give several of that kind. */
  outputNode?: string;
};

export interface GenerationBackend {
  readonly kind: BackendKind;
  submit(job: SubmitJob): Promise<{ backendJobId: string }>;
  /**
   * `want` names the output to deliver; without it, a backend uses what the job
   * was submitted with, or a video for a job it does not know (an app restart).
   */
  get(backendJobId: string, want?: OutputWanted): Promise<BackendJob>;
  cancel(backendJobId: string): Promise<void>;
}
