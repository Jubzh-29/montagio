import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isBackendError, type JobState } from '@montagio/comfy-adapter';
import type { Aspect } from '@montagio/presets';
import {
  concatClips,
  ensureTools,
  exportVertical,
  extractLastFrame,
  probe,
  SequenceToolError,
} from '@montagio/sequence';
import { getEnv } from './env';
import {
  cancelGeneration,
  checkGenerationInput,
  createGeneration,
  GenerationError,
  getGeneration,
  IDEMPOTENCY_WINDOW_MS,
  mediaFileFor,
  mediaUrlFor,
} from './generations';
import { withLock } from './lock';
import { getServices } from './services';
import { readRecord, writeAtomic } from './store';
import { readUploadMeta, saveUploadFromFile, UploadError } from './uploads';

export const MIN_SHOTS = 2;
export const MAX_SHOTS = 3;

export type ShotRecord = {
  presetId: string;
  modelId?: string;
  userPrompt?: string;
  startImageRef?: string;
  generationId?: string;
  state: 'pending' | JobState;
  error?: string;
};

export type SequenceState = 'running' | 'assembling' | 'succeeded' | 'failed' | 'canceled';

export type SequenceRecord = {
  id: string;
  imageRef: string;
  aspect: Aspect;
  idempotencyKey: string;
  state: SequenceState;
  shots: ShotRecord[];
  currentShot: number;
  progress: number;
  outputUrl?: string;
  verticalUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSequenceInput = {
  imageRef: string;
  shots: { presetId: string; modelId?: string; userPrompt?: string }[];
  idempotencyKey: string;
};

type CreateResult = { record: SequenceRecord; created: boolean };

const TERMINAL = new Set<SequenceState>(['succeeded', 'failed', 'canceled']);
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

// Shared by every route bundle of this process (Next bundles routes separately).
const holder = globalThis as typeof globalThis & {
  __montagioSequenceCreations?: Map<string, Promise<CreateResult>>;
  __montagioAssemblies?: Map<string, Promise<void>>;
};
const creations = (holder.__montagioSequenceCreations ??= new Map());
const assemblies = (holder.__montagioAssemblies ??= new Map());

const sequencesDir = () => join(getEnv().data, 'sequences');
const sequenceDir = (id: string) => join(sequencesDir(), id);
const keyFile = (key: string) =>
  join(sequencesDir(), '_keys', `${createHash('sha256').update(key).digest('hex')}.json`);
const shotKey = (record: Pick<SequenceRecord, 'idempotencyKey'>, index: number) =>
  `${record.idempotencyKey}#shot${index}`;

async function saveSequence(record: SequenceRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await mkdir(sequenceDir(record.id), { recursive: true });
  await writeAtomic(join(sequenceDir(record.id), 'record.json'), JSON.stringify(record, null, 2));
}

export async function readSequence(id: string): Promise<SequenceRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(sequenceDir(id), 'record.json'), 'utf8')) as SequenceRecord;
  } catch {
    return null;
  }
}

export async function createSequence(input: CreateSequenceInput): Promise<CreateResult> {
  const pending = creations.get(input.idempotencyKey);
  if (pending) return { record: (await pending).record, created: false };
  const creation = createSequenceOnce(input).finally(() => creations.delete(input.idempotencyKey));
  creations.set(input.idempotencyKey, creation);
  return creation;
}

async function createSequenceOnce(input: CreateSequenceInput): Promise<CreateResult> {
  try {
    const previous = JSON.parse(await readFile(keyFile(input.idempotencyKey), 'utf8')) as { id: string; createdAt: string };
    if (Date.now() - Date.parse(previous.createdAt) < IDEMPOTENCY_WINDOW_MS) {
      const record = await readSequence(previous.id);
      if (record) return { record, created: false };
    }
  } catch {
    // no previous sequence for this key
  }

  // Validate everything before the first render starts.
  if (input.shots.length < MIN_SHOTS || input.shots.length > MAX_SHOTS) throw new GenerationError('invalid-shots');
  const lib = await getServices().library;
  if (input.shots.some((shot) => !lib.presets.has(shot.presetId))) throw new GenerationError('unknown-preset');
  const upload = await readUploadMeta(input.imageRef);
  if (!upload) throw new GenerationError('unknown-image');
  try {
    await ensureTools();
  } catch (error) {
    console.error('[montagio] FFmpeg is required before a sequence:', error instanceof Error ? error.message : error);
    throw new GenerationError('ffmpeg-missing');
  }
  // Every shot must compile now: a later shot that cannot render would waste the earlier renders.
  for (const shot of input.shots) {
    await checkGenerationInput({ ...shot, imageRef: input.imageRef });
  }

  const now = new Date().toISOString();
  const record: SequenceRecord = {
    id: randomUUID(),
    imageRef: input.imageRef,
    aspect: upload.aspect,
    idempotencyKey: input.idempotencyKey,
    state: 'running',
    shots: input.shots.map((shot) => ({
      presetId: shot.presetId,
      ...(shot.modelId ? { modelId: shot.modelId } : {}),
      ...(shot.userPrompt ? { userPrompt: shot.userPrompt } : {}),
      state: 'pending' as const,
    })),
    currentShot: 0,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  await startShot(record, 0, input.imageRef);
  await saveSequence(record);
  await mkdir(join(sequencesDir(), '_keys'), { recursive: true });
  await writeFile(keyFile(input.idempotencyKey), JSON.stringify({ id: record.id, createdAt: now }));
  return { record, created: true };
}

async function startShot(record: SequenceRecord, index: number, imageRef: string): Promise<void> {
  const shot = record.shots[index]!;
  const { record: generation } = await createGeneration({
    presetId: shot.presetId,
    modelId: shot.modelId,
    userPrompt: shot.userPrompt,
    imageRef,
    idempotencyKey: shotKey(record, index),
  });
  shot.startImageRef = imageRef;
  shot.generationId = generation.id;
  shot.state = generation.state;
  record.currentShot = index;
}

/** Poll-driven: every call moves the sequence forward by at most one step. */
export function advanceSequence(id: string): Promise<SequenceRecord | null> {
  return withLock(id, async () => {
    const record = await readSequence(id);
    if (!record || TERMINAL.has(record.state)) return record;
    if (record.state === 'assembling') {
      ensureAssembly(record.id);
      return record;
    }

    const index = record.currentShot;
    const shot = record.shots[index]!;
    const generation = shot.generationId ? await getGeneration(shot.generationId) : null;
    if (!generation) return finish(record, 'failed', 'lost');
    shot.state = generation.state;

    if (generation.state === 'failed') {
      shot.error = generation.error ?? 'failed';
      return finish(record, 'failed', shot.error);
    }
    if (generation.state === 'canceled') return finish(record, 'canceled');
    if (generation.state !== 'succeeded') {
      record.progress = ((index + generation.progress) / record.shots.length) * 0.9;
      await saveSequence(record);
      return record;
    }

    if (index < record.shots.length - 1) {
      // Chain: the next shot starts on the last frame of this one.
      const clip = mediaFileFor(generation.outputUrl);
      if (!clip) return finish(record, 'failed', 'missing-output');
      try {
        const frame = join(sequenceDir(record.id), `shot${index}-last.png`);
        await mkdir(sequenceDir(record.id), { recursive: true });
        await extractLastFrame(clip, frame);
        const upload = await saveUploadFromFile(frame);
        await startShot(record, index + 1, upload.imageRef);
      } catch (error) {
        // Errors that a retry cannot fix end the sequence; anything else is retried on the next poll.
        // The backend out of reach: the next poll chains again.
        if (isBackendError(error) && error.retryable) {
          console.warn(`[montagio] sequence ${record.id}: backend out of reach while chaining shot ${index + 1}, still waiting`);
          return record;
        }
        const code = permanentErrorCode(error);
        if (!code) throw error;
        console.error(`[montagio] sequence ${record.id}: chaining shot ${index + 1} failed`, error);
        return finish(record, 'failed', code);
      }
      record.progress = ((index + 1) / record.shots.length) * 0.9;
      await saveSequence(record);
      return record;
    }

    record.state = 'assembling';
    record.progress = 0.95;
    await saveSequence(record);
    ensureAssembly(record.id);
    return record;
  });
}

/** Stable error code for failures a retry cannot fix, or null for transient ones. */
function permanentErrorCode(error: unknown): string | null {
  if (error instanceof GenerationError) return error.code;
  if (isBackendError(error) && !error.retryable) return error.code;
  if (error instanceof SequenceToolError) return error.code === 'tool-missing' ? 'ffmpeg-missing' : 'ffmpeg-failed';
  if (error instanceof UploadError) return 'frame-unreadable';
  return null;
}

async function finish(record: SequenceRecord, state: 'failed' | 'canceled', error?: string): Promise<SequenceRecord> {
  record.state = state;
  if (error) record.error = error;
  await saveSequence(record);
  return record;
}

/** Start the montage once per process; a sequence left "assembling" by a restart starts it again. */
function ensureAssembly(id: string): void {
  if (assemblies.has(id)) return;
  const job = assemble(id)
    .catch((error: unknown) => {
      // The client gets a stable code; the details (paths, stderr) stay in the server log.
      console.error(`[montagio] sequence ${id}: montage failed`, error);
      const code = error instanceof SequenceToolError && error.code === 'tool-missing' ? 'ffmpeg-missing' : 'assembly-failed';
      return withLock(id, async () => {
        const record = await readSequence(id);
        if (record && record.state === 'assembling') await finish(record, 'failed', code);
      });
    })
    .finally(() => assemblies.delete(id));
  assemblies.set(id, job);
}

async function assemble(id: string): Promise<void> {
  const record = await readSequence(id);
  if (!record) return;
  const clips: string[] = [];
  for (const shot of record.shots) {
    const generation = shot.generationId ? await readRecord(shot.generationId) : null;
    const clip = mediaFileFor(generation?.outputUrl);
    if (!clip) throw new Error(`no output for shot ${shot.presetId}`);
    clips.push(clip);
  }
  const first = await probe(clips[0]!);
  const film = join(sequenceDir(id), 'film.mp4');
  const vertical = join(sequenceDir(id), 'film-9x16.mp4');
  await mkdir(sequenceDir(id), { recursive: true });
  await concatClips(clips, film, { width: first.width, height: first.height }, Math.round(first.fps) || 16);
  await exportVertical(film, vertical);

  await withLock(id, async () => {
    const latest = await readSequence(id);
    if (!latest || latest.state !== 'assembling') return;
    latest.state = 'succeeded';
    latest.progress = 1;
    const filmUrl = mediaUrlFor(film);
    const verticalUrl = mediaUrlFor(vertical);
    if (filmUrl) latest.outputUrl = filmUrl;
    if (verticalUrl) latest.verticalUrl = verticalUrl;
    await saveSequence(latest);
  });
}

export function cancelSequence(id: string): Promise<SequenceRecord | null> {
  return withLock(id, async () => {
    const record = await readSequence(id);
    if (!record || TERMINAL.has(record.state)) return record;
    const generationId = record.shots[record.currentShot]?.generationId;
    if (generationId) await cancelGeneration(generationId);
    return finish(record, 'canceled');
  });
}
