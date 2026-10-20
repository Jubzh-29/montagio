import { randomInt, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { IDEMPOTENCY_WINDOW_MS, isBackendError, type BackendErrorCode } from '@montagio/comfy-adapter';
import { compileJob, CompileError, validatePreset, type Preset } from '@montagio/presets';
import { ensureTools, probe, tagClip } from '@montagio/sequence';
import { MAX_PRESET_YAML_BYTES, MAX_REQUEST_BYTES } from '@/lib/limits';
import { getEnv } from './env';
import { getServices } from './services';
import {
  lookupKey,
  readRecord,
  rememberKey,
  savePresetText,
  saveRecord,
  saveWorkflow,
  type GenerationRecord,
} from './store';
import { readUploadMeta } from './uploads';

// The backend forgets a key after the same window: one constant for both layers.
export { IDEMPOTENCY_WINDOW_MS };
// The showcase's in-page router applies the same limits.
export { MAX_PRESET_YAML_BYTES, MAX_REQUEST_BYTES };
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

export type GenerationErrorCode =
  | 'unknown-preset'
  | 'unknown-image'
  | 'model-incompatible'
  | 'invalid-shots'
  | 'ffmpeg-missing'
  | 'invalid-preset'
  | 'preset-too-large';

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    /** For "invalid-preset": one line per problem, as `montagio preset validate` prints them. */
    readonly problems?: string[],
  ) {
    super(code);
  }
}

/** Validate a preset pasted in the remix editor, on `modelId` if given, else on its own models. */
export async function checkPresetText(text: string, modelId?: string): Promise<Preset> {
  if (Buffer.byteLength(text, 'utf8') > MAX_PRESET_YAML_BYTES) throw new GenerationError('preset-too-large');
  const lib = await getServices().library;
  const result = validatePreset(text, 'remix.yaml', lib, modelId ? { modelId } : undefined);
  if (!result.ok) throw new GenerationError('invalid-preset', result.problems);
  return result.preset;
}

export type CreateGenerationInput = {
  /** A preset of the library, or… */
  presetId?: string;
  /** …the text of a remixed preset, which replaces presetId. */
  presetYaml?: string;
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
const holder = globalThis as typeof globalThis & {
  __montagioInflight?: Map<string, Promise<CreateResult>>;
  __montagioTaggedClips?: Map<string, Promise<string | undefined>>;
};
const inflight = (holder.__montagioInflight ??= new Map());
// Taggings in flight, by clip: concurrent polls share one; once written, clip.mp4 on disk is the record.
const taggedClips = (holder.__montagioTaggedClips ??= new Map());

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
  const preset =
    input.presetYaml !== undefined ? await checkPresetText(input.presetYaml, input.modelId) : lib.presets.get(input.presetId ?? '');
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
  // Every delivered clip is tagged by FFmpeg: without it, refuse before a second of GPU is spent.
  try {
    await ensureTools();
  } catch (error) {
    console.error('[montagio] FFmpeg is required before a render:', error instanceof Error ? error.message : error);
    throw new GenerationError('ffmpeg-missing');
  }

  const id = randomUUID();
  await saveWorkflow(id, compiled.workflow);
  if (input.presetYaml !== undefined) await savePresetText(id, input.presetYaml);
  // The start image travels as a file: the backend uploads it and binds it to the loader node.
  const imageBinding = model.bindings.image;
  const { backendJobId } = await backend.submit({
    workflow: compiled.workflow,
    presetId: preset.id,
    idempotencyKey: input.idempotencyKey,
    ...(imageBinding
      ? { files: [{ node: imageBinding.node, field: imageBinding.field, path: join(getEnv().data, ...input.imageRef.split('/')) }] }
      : {}),
  });
  const now = new Date().toISOString();
  const record: GenerationRecord = {
    id,
    presetId: preset.id,
    modelId: model.id,
    imageRef: input.imageRef,
    ...(input.userPrompt ? { userPrompt: input.userPrompt } : {}),
    ...(input.presetYaml !== undefined ? { remix: true as const } : {}),
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

const BACKEND_STATUS: Record<BackendErrorCode, number> = {
  'workflow-rejected': 422,
  'backend-unavailable': 503,
  'backend-error': 502,
};

/** The HTTP answer for a known failure of a create route, or null for an unexpected error. */
export function failureResponse(error: unknown): Response | null {
  if (error instanceof GenerationError) {
    if (error.code === 'invalid-preset') return Response.json({ error: error.code, problems: error.problems ?? [] }, { status: 400 });
    if (error.code === 'preset-too-large') return Response.json({ error: error.code }, { status: 413 });
    // A missing FFmpeg is the server's problem, not the request's.
    return Response.json({ error: error.code }, { status: error.code === 'ffmpeg-missing' ? 503 : 400 });
  }
  if (isBackendError(error)) return Response.json({ error: error.code }, { status: BACKEND_STATUS[error.code] });
  return null;
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

  let job;
  try {
    job = await getServices().backend.get(record.backendJobId);
  } catch (error) {
    // The proxy or the pod is out of reach for now; the render may well go on. Keep the
    // last known state so the Studio keeps polling instead of giving up on a paid render.
    if (!isBackendError(error) || !error.retryable) throw error;
    console.warn(`[montagio] generation ${id}: backend out of reach, still waiting (${error.message})`);
    return record;
  }
  const updated: GenerationRecord = {
    ...record,
    state: job.state,
    progress: job.progress,
    updatedAt: new Date().toISOString(),
  };
  if (job.state === 'succeeded' && job.outputPath) {
    const url = await deliverClip(record.id, job.outputPath);
    if (url) {
      updated.outputUrl = url;
      const frames = await frameCount(mediaFileFor(url));
      if (frames !== undefined) updated.frames = frames;
    }
  }
  if (job.state === 'failed') updated.error = job.error ?? 'failed';
  await saveRecord(updated);
  return updated;
}

/** A clip's frame count, or undefined when probe cannot read it (the HD action then stays hidden). */
async function frameCount(file: string | null): Promise<number | undefined> {
  if (!file) return undefined;
  try {
    const info = await probe(file);
    return Math.round(info.duration_s * info.fps);
  } catch {
    return undefined;
  }
}

/**
 * URL of the clip the user gets: a copy of the backend's output that carries the
 * AI-generated mention, under data/generations/<id>/clip.mp4. If FFmpeg cannot
 * write it, the render is not lost: the raw output is delivered untagged and the
 * error goes to the server log.
 */
function deliverClip(id: string, outputPath: string): Promise<string | undefined> {
  const clip = join(getEnv().data, 'generations', id, 'clip.mp4');
  let delivery = taggedClips.get(clip);
  if (!delivery) {
    delivery = (async () => {
      try {
        await access(clip).catch(() => tagClip(outputPath, clip));
        return mediaUrlFor(clip);
      } catch (error) {
        console.error(`[montagio] generation ${id}: the AI-generated mention could not be written, clip delivered untagged`, error);
        return mediaUrlFor(outputPath);
      }
    })().finally(() => taggedClips.delete(clip));
    taggedClips.set(clip, delivery);
  }
  return delivery;
}

export async function cancelGeneration(id: string): Promise<GenerationRecord | null> {
  const record = await readRecord(id);
  if (!record) return null;
  if (!TERMINAL.has(record.state)) await getServices().backend.cancel(record.backendJobId);
  return getGeneration(id);
}
