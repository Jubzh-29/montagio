import { randomInt, randomUUID } from 'node:crypto';
import { join, relative, sep } from 'node:path';
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

export type GenerationErrorCode =
  | 'unknown-preset'
  | 'unknown-image'
  | 'model-incompatible'
  | 'invalid-shots'
  | 'ffmpeg-missing';

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

type CreateResult = { record: GenerationRecord; created: boolean };

// Creations in flight, keyed by idempotency key and shared by every route
// bundle of this process: a retry that arrives while the first request is
// still running waits for it instead of starting a second render.
const holder = globalThis as typeof globalThis & { __montagioInflight?: Map<string, Promise<CreateResult>> };
const inflight = (holder.__montagioInflight ??= new Map());

export async function createGeneration(input: CreateGenerationInput): Promise<CreateResult> {
  const pending = inflight.get(input.idempotencyKey);
  if (pending) return { record: (await pending).record, created: false };
  const creation = createGenerationOnce(input).finally(() => inflight.delete(input.idempotencyKey));
  inflight.set(input.idempotencyKey, creation);
  return creation;
}

/** Look everything up and compile the workflow; throws GenerationError on any invalid input. */
async function resolveJob(input: Omit<CreateGenerationInput, 'idempotencyKey'>, seed: number) {
  const lib = await getServices().library;
  const preset = lib.presets.get(input.presetId);
  if (!preset) throw new GenerationError('unknown-preset');
  const upload = await readUploadMeta(input.imageRef);
  if (!upload) throw new GenerationError('unknown-image');
  const model = lib.models.get(input.modelId ?? preset.models.preferred);
  const template = model ? lib.templates.get(model.workflow) : undefined;
  if (!model || !template) throw new GenerationError('model-incompatible');
  try {
    const compiled = compileJob(preset, model, template, {
      imageRef: input.imageRef,
      userPrompt: input.userPrompt,
      seed,
      aspect: upload.aspect,
    });
    return { preset, model, upload, compiled };
  } catch (error) {
    if (error instanceof CompileError) throw new GenerationError('model-incompatible');
    throw error;
  }
}

/** Dry run: would this generation be accepted? Nothing is rendered or stored. */
export async function checkGenerationInput(input: Omit<CreateGenerationInput, 'idempotencyKey'>): Promise<void> {
  await resolveJob(input, 0);
}

async function createGenerationOnce(input: CreateGenerationInput): Promise<CreateResult> {
  const previous = await lookupKey(input.idempotencyKey);
  if (previous && Date.now() - Date.parse(previous.createdAt) < IDEMPOTENCY_WINDOW_MS) {
    const record = await readRecord(previous.id);
    if (record) return { record, created: false };
  }

  const { backend } = getServices();
  const seed = input.seed ?? randomInt(0, 2 ** 32);
  const { preset, model, upload, compiled } = await resolveJob(input, seed);

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

/** Inverse of mediaUrlFor: the file behind a /media/data or /media/demo-assets URL, or null. */
export function mediaFileFor(url: string | undefined): string | null {
  const match = /^\/media\/(data|demo-assets)\/(.+)$/.exec(url ?? '');
  if (!match) return null;
  const segments = match[2]!.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\\:\u0000]/.test(segment))) {
    return null;
  }
  const { root, data } = getEnv();
  return join(match[1] === 'data' ? data : join(root, 'demo-assets'), ...segments);
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
