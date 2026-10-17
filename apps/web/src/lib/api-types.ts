export type PresetSummary = {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  poses: string[];
  speed: number;
  defaultModel: string;
};

export type ModelSummary = {
  id: string;
  name: string;
  kind: 'video' | 'image';
  tier: 'quality' | 'fast';
  license: string;
  estimate_s: { '480p': number; '720p'?: number };
};

export type UploadResult = { imageRef: string; width: number; height: number; aspect: '16:9' | '9:16' | '1:1' };

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type GenerationRecord = {
  id: string;
  presetId: string;
  modelId: string;
  state: JobState;
  progress: number;
  outputUrl?: string;
  error?: string;
};

export type OpenStackReport = {
  ok: boolean;
  checkedAt: string;
  models: { id: string; license: string; weights: { id: string; license: string }[] }[];
  violations: { rule: string; file: string; detail: string }[];
};

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['succeeded', 'failed', 'canceled']);

export type SequenceSummary = {
  id: string;
  state: 'running' | 'assembling' | 'succeeded' | 'failed' | 'canceled';
  shots: { presetId: string; state: string }[];
  currentShot: number;
  progress: number;
  outputUrl?: string;
  verticalUrl?: string;
  error?: string;
};
