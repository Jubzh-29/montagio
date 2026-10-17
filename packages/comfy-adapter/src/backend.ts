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

/** A compiled workflow to run, plus the local files its loader nodes need (the start image). */
export type SubmitJob = {
  workflow: ApiWorkflow;
  presetId: string;
  idempotencyKey: string;
  files?: { node: string; field: string; path: string }[];
};

export interface GenerationBackend {
  readonly kind: BackendKind;
  submit(job: SubmitJob): Promise<{ backendJobId: string }>;
  get(backendJobId: string): Promise<BackendJob>;
  cancel(backendJobId: string): Promise<void>;
}
