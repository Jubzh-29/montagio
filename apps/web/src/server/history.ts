import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Library } from '@montagio/presets';
import { TERMINAL_STATES, type HistoryItem, type JobState, type Reprise } from '@/lib/api-types';
import { recipeUrlOf, type RecipeSource } from '@/lib/recipe-url';
import { getEnv } from './env';
import { getGeneration } from './generations';
import { jobs, type JobRecord } from './jobs';
import { advanceSequence, readSequence, type SequenceRecord } from './sequences';
import { getServices } from './services';
import { readRecord, type GenerationRecord } from './store';
import { readUploadMeta, readVideoMeta } from './uploads';

export const HISTORY_LIMIT = 200;
/** A shot of a film is a generation of its own: its idempotency key says so. */
const SHOT_KEY = /#shot\d+$/;

async function readRecords<T>(kind: 'generations' | 'sequences'): Promise<T[]> {
  const dir = join(getEnv().data, kind);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const records = await Promise.all(
    names
      .filter((name) => name !== '_keys')
      .map((name) =>
        readFile(join(dir, name, 'record.json'), 'utf8')
          .then((text) => JSON.parse(text) as T)
          .catch(() => null),
      ),
  );
  return records.filter((record): record is Awaited<T> => record !== null) as T[];
}

/** How far a step can take a render: its state, its progress and, for a film, its shot. */
const stage = (record: { state: string; progress?: number; currentShot?: number }) => `${record.state}:${record.progress}:${record.currentShot}`;

/**
 * Renders move on when they are polled, and nobody polls a render the Studio left behind
 * (the visitor went to History mid-render). Reading the history advances each unfinished
 * one as far as it goes now, a film one step at a time; one that cannot be read stays as it is.
 */
async function caughtUp<T extends { state: string }>(record: T, advance: () => Promise<T | null>): Promise<T> {
  let current = record;
  for (let step = 0; step < 8 && !TERMINAL_STATES.has(current.state as JobState); step++) {
    const next = await advance().catch(() => null);
    if (!next || stage(next) === stage(current)) return next ?? current;
    current = next;
  }
  return current;
}

/** The photo to reopen, or the note that it is gone. */
async function photo(imageRef: string | undefined): Promise<Pick<Reprise, 'imageRef' | 'personal' | 'photoMissing'>> {
  const meta = imageRef ? await readUploadMeta(imageRef) : null;
  return meta ? { imageRef: meta.imageRef, personal: meta.personal } : { photoMissing: true };
}

const presetName = (lib: Library, id: string) => lib.presets.get(id)?.name ?? id;
const modelName = (lib: Library, id: string | undefined) =>
  (id && (lib.models.get(id)?.name ?? lib.extensionModels.get(id)?.name)) || id || '';

async function fromGeneration(lib: Library, record: GenerationRecord): Promise<HistoryItem> {
  return {
    key: `generation:${record.id}`,
    source: 'generation',
    kind: 'clip',
    task: 'camera',
    name: presetName(lib, record.presetId),
    modelName: modelName(lib, record.modelId),
    createdAt: record.createdAt,
    previewUrl: record.outputUrl!,
    downloadUrl: record.outputUrl!,
    reprise: {
      tab: 'camera',
      ...(await photo(record.imageRef)),
      presetId: record.presetId,
      modelId: record.modelId,
      ...(record.userPrompt ? { prompt: record.userPrompt } : {}),
      ...(record.remix ? { remixGenerationId: record.id } : {}),
      seed: record.seed,
    },
    recipeUrl: recipeUrlOf('generation', record.id),
  };
}

async function fromSequence(lib: Library, record: SequenceRecord): Promise<HistoryItem> {
  const modelId = record.shots[0]?.modelId;
  return {
    key: `sequence:${record.id}`,
    source: 'sequence',
    kind: 'film',
    task: 'film',
    name: record.shots.map((shot) => presetName(lib, shot.presetId)).join(' → '),
    modelName: modelName(lib, modelId ?? lib.presets.get(record.shots[0]?.presetId ?? '')?.models.preferred),
    createdAt: record.createdAt,
    previewUrl: record.outputUrl!,
    downloadUrl: record.outputUrl!,
    reprise: {
      tab: 'film',
      ...(await photo(record.imageRef)),
      ...(modelId ? { modelId } : {}),
      shots: record.shots.map((shot) => ({
        presetId: shot.presetId,
        ...(shot.userPrompt ? { prompt: shot.userPrompt } : {}),
        ...(shot.seed !== undefined ? { seed: shot.seed } : {}),
      })),
    },
    recipeUrl: recipeUrlOf('sequence', record.id),
  };
}

/** The history item of an HD clip's source, whatever made it. */
async function parentItem(lib: Library, parent: JobRecord['parent']): Promise<HistoryItem | null> {
  if (parent?.source === 'generation') {
    const record = await getGeneration(parent.id).catch(() => null);
    return record?.state === 'succeeded' && record.outputUrl ? fromGeneration(lib, record) : null;
  }
  if (parent?.source === 'job') {
    const record = await jobs.read(parent.id);
    return record?.state === 'succeeded' && record.outputUrl ? fromJob(lib, record) : null;
  }
  return null;
}

async function fromJob(lib: Library, record: JobRecord): Promise<HistoryItem | null> {
  const base = {
    key: `job:${record.id}`,
    source: 'job' as const,
    name: record.label.name ?? record.task,
    modelName: modelName(lib, record.modelId),
    createdAt: record.createdAt,
    previewUrl: record.outputUrl!,
    downloadUrl: record.outputUrl!,
    recipeUrl: recipeUrlOf('job', record.id),
  };
  switch (record.task) {
    case 't2i':
    case 'edit':
    case 'moodboard':
    case 'image-upscale':
      // The photo it made is what comes back: the start photo of the next render.
      return {
        ...base,
        kind: 'photo',
        task: record.task,
        reprise: {
          tab: 'camera',
          ...(await photo(record.outputImageRef)),
          ...(record.task === 't2i' && typeof record.inputs.prompt === 'string' ? { prompt: record.inputs.prompt } : {}),
          ...(record.task === 'edit' && typeof record.inputs.scene === 'string' ? { prompt: record.inputs.scene } : {}),
        },
      };
    case 'effect':
      return {
        ...base,
        kind: 'clip',
        task: 'effect',
        reprise: {
          tab: 'effects',
          ...(await photo(typeof record.inputs.imageRef === 'string' ? record.inputs.imageRef : undefined)),
          effectId: String(record.inputs.effectId),
          ...(record.inputs.subject ? { prompt: String(record.inputs.subject) } : {}),
          seed: record.seed,
        },
      };
    case 'hook':
      return {
        ...base,
        kind: 'clip',
        task: 'hook',
        reprise: {
          tab: 'effects',
          ...(await photo(typeof record.inputs.imageRef === 'string' ? record.inputs.imageRef : undefined)),
          hookId: String(record.inputs.hookId),
          seed: record.seed,
        },
      };
    case 'avatar':
      return {
        ...base,
        kind: 'clip',
        task: 'avatar',
        reprise: {
          tab: 'avatar',
          ...(await photo(typeof record.inputs.imageRef === 'string' ? record.inputs.imageRef : undefined)),
          prompt: String(record.inputs.text),
          language: record.inputs.language === 'fr' ? 'fr' : 'en',
          seed: record.seed,
        },
      };
    case 'music': {
      // A film with music is a film of its own; Reuse reopens the silent film's setup.
      const film = record.parent ? await readSequence(record.parent.id) : null;
      const parent = film?.state === 'succeeded' && film.outputUrl ? await fromSequence(lib, film) : null;
      return {
        ...base,
        kind: 'film',
        task: 'music',
        name: parent ? `${parent.name} ♪` : base.name,
        reprise: parent?.reprise ?? { tab: 'film' },
      };
    }
    case 'motion': {
      const videoRef = typeof record.inputs.videoRef === 'string' ? record.inputs.videoRef : '';
      return {
        ...base,
        kind: 'clip',
        task: 'motion',
        reprise: {
          tab: 'motion',
          ...(await photo(typeof record.inputs.imageRef === 'string' ? record.inputs.imageRef : undefined)),
          ...((await readVideoMeta(videoRef)) ? { videoRef } : {}),
          ...(record.inputs.character ? { prompt: String(record.inputs.character) } : {}),
          ...(record.inputs.motion ? { motion: String(record.inputs.motion) } : {}),
          seed: record.seed,
        },
      };
    }
    case 'translate':
      // A clip said in another language: Reuse goes back to the Avatar tab.
      return { ...base, kind: 'clip', task: 'translate', reprise: { tab: 'avatar' } };
    case 'voice-change':
      // A clip in another voice: Reuse goes back to the Avatar tab.
      return { ...base, kind: 'clip', task: 'voice-change', reprise: { tab: 'avatar' } };
    case 'ad':
      // A ready-to-post ad: Reuse goes back to the Effects wall with its effect chosen.
      return { ...base, kind: 'clip', task: 'ad', reprise: { tab: 'effects', effectId: String(record.inputs.effectId) } };
    case 'upscale': {
      // An HD clip is a clip of its own; Reuse reopens the setup of the clip it was made from.
      const parent = await parentItem(lib, record.parent);
      return {
        ...base,
        kind: 'clip',
        task: 'upscale',
        name: parent ? `${parent.name} · HD` : base.name,
        reprise: parent?.reprise ?? { tab: 'camera' },
        ...(parent?.recipeUrl ? { reproduces: parent.recipeUrl } : {}),
      };
    }
    default:
      return null;
  }
}

/** The history item of one record, finished or not (the recipe of a render being delivered reads it too); null if unknown. */
export async function historyItem(source: RecipeSource, id: string): Promise<HistoryItem | null> {
  const lib = await getServices().library;
  // As stored: moving a render forward here would deliver it again from inside its own delivery.
  if (source === 'generation') {
    const record = await readRecord(id);
    return record ? fromGeneration(lib, record) : null;
  }
  if (source === 'sequence') {
    const record = await readSequence(id);
    return record ? fromSequence(lib, record) : null;
  }
  const record = await jobs.read(id);
  return record ? fromJob(lib, record) : null;
}

/** What was made, newest first: finished items only, films whole (their shots are not listed apart). */
export async function listHistory(): Promise<HistoryItem[]> {
  const lib = await getServices().library;
  const [generations, sequences, jobRecords] = await Promise.all([
    // A film's shots move on with their film.
    readRecords<GenerationRecord>('generations').then((records) =>
      Promise.all(records.map((record) => (SHOT_KEY.test(record.idempotencyKey) ? record : caughtUp(record, () => getGeneration(record.id))))),
    ),
    readRecords<SequenceRecord>('sequences').then((records) => Promise.all(records.map((record) => caughtUp(record, () => advanceSequence(record.id))))),
    jobs.list().then((records) => Promise.all(records.map((record) => caughtUp(record, () => jobs.get(record.id))))),
  ]);
  const items = await Promise.all([
    ...generations
      .filter((record) => record.state === 'succeeded' && record.outputUrl && !SHOT_KEY.test(record.idempotencyKey))
      .map((record) => fromGeneration(lib, record)),
    ...sequences.filter((record) => record.state === 'succeeded' && record.outputUrl).map((record) => fromSequence(lib, record)),
    ...jobRecords.filter((record) => record.state === 'succeeded' && record.outputUrl).map((record) => fromJob(lib, record)),
  ]);
  return items
    .filter((item): item is HistoryItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, HISTORY_LIMIT);
}
