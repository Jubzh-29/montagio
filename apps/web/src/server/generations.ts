import { randomInt, randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';
import { compileJob, CompileError } from '@montagio/presets';
import { getEnv } from './env';
import { getServices } from './services';
import {
  lookupKey,
  readRecord,
  rememberKey,
  saveRecord,
  saveWorkflow,
  type GenerationRecord,
} from './store';
import { readUploadMeta } from './uploads';

export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

export type GenerationErrorCode = 'unknown-preset' | 'unknown-image' | 'model-incompatible';

export class GenerationError extends Error {
  constructor(readonly code: GenerationErrorCode) {
    super(code);
  }
}

export type CreateGenerationInput = {
  presetId: string;
  modelId?: string;
  imageRef: string;
  userPrompt?: string;
  seed?: number;
  idempotencyKey: string;
};

export async function createGeneration(
  input: CreateGenerationInput,
): Promise<{ record: GenerationRecord; created: boolean }> {
  const previous = await lookupKey(input.idempotencyKey);
  if (previous && Date.now() - Date.parse(previous.createdAt) < IDEMPOTENCY_WINDOW_MS) {
    const record = await readRecord(previous.id);
    if (record) return { record, created: false };
  }

  const { library, backend } = getServices();
  const lib = await library;
  const preset = lib.presets.get(input.presetId);
  if (!preset) throw new GenerationError('unknown-preset');
  const upload = await readUploadMeta(input.imageRef);
  if (!upload) throw new GenerationError('unknown-image');
  const model = lib.models.get(input.modelId ?? preset.models.preferred);
  const template = model ? lib.templates.get(model.workflow) : undefined;
  if (!model || !template) throw new GenerationError('model-incompatible');

  const seed = input.seed ?? randomInt(0, 2 ** 32);
  let compiled;
  try {
    compiled = compileJob(preset, model, template, {
      imageRef: input.imageRef,
      userPrompt: input.userPrompt,
      seed,
      aspect: upload.aspect,
    });
  } catch (error) {
    if (error instanceof CompileError) throw new GenerationError('model-incompatible');
    throw error;
  }

  const id = randomUUID();
  await saveWorkflow(id, compiled.workflow);
  const { backendJobId } = await backend.submit({
    workflow: compiled.workflow,
    presetId: preset.id,
    idempotencyKey: input.idempotencyKey,
  });
  const now = new Date().toISOString();
  const record: GenerationRecord = {
    id,
    presetId: preset.id,
    modelId: model.id,
    imageRef: input.imageRef,
    ...(input.userPrompt ? { userPrompt: input.userPrompt } : {}),
    seed,
    aspect: upload.aspect,
    state: 'queued',
    progress: 0,
    backendKind: backend.kind,
    backendJobId,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  await saveRecord(record);
  await rememberKey(input.idempotencyKey, id, now);
  return { record, created: true };
}

/** Public URL for a file produced by a backend (data/ or demo-assets/ only). */
export function mediaUrlFor(absolutePath: string): string | undefined {
  const { root, data } = getEnv();
  for (const [prefix, base] of [
    ['data', data],
    ['demo-assets', `${root}${sep}demo-assets`],
  ] as const) {
    const rel = relative(base, absolutePath);
    if (rel && !rel.startsWith('..') && !rel.includes(':')) return `/media/${prefix}/${rel.split(sep).join('/')}`;
  }
  return undefined;
}

export async function getGeneration(id: string): Promise<GenerationRecord | null> {
  const record = await readRecord(id);
  if (!record || TERMINAL.has(record.state)) return record;

  const job = await getServices().backend.get(record.backendJobId);
  const updated: GenerationRecord = {
    ...record,
    state: job.state,
    progress: job.progress,
    updatedAt: new Date().toISOString(),
  };
  if (job.state === 'succeeded' && job.outputPath) {
    const url = mediaUrlFor(job.outputPath);
    if (url) updated.outputUrl = url;
  }
  if (job.state === 'failed') updated.error = job.error ?? 'failed';
  await saveRecord(updated);
  return updated;
}

export async function cancelGeneration(id: string): Promise<GenerationRecord | null> {
  const record = await readRecord(id);
  if (!record) return null;
  if (!TERMINAL.has(record.state)) await getServices().backend.cancel(record.backendJobId);
  return getGeneration(id);
}
