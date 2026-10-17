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

export interface GenerationBackend {
  readonly kind: BackendKind;
  submit(job: { workflow: ApiWorkflow; presetId: string; idempotencyKey: string }): Promise<{ backendJobId: string }>;
  get(backendJobId: string): Promise<BackendJob>;
  cancel(backendJobId: string): Promise<void>;
}
