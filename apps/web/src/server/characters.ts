import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterKind, CharacterSummary, CharacterTraits, CharacterType } from '@/lib/api-types';
import { FACE_KEY_PREFIX, faceById } from '@/lib/character-bank';
import { CHARACTER_KINDS, CHARACTER_TYPES, knownTraits } from '@/lib/characters';
import { getEnv } from './env';
import { JobError } from './errors';
import { assertAllowedText } from './guards';
import { writeAtomic } from './store';
import { readUploadMeta } from './uploads';

/**
 * Characters: a fictional person (or creature) made once from a text, saved with a name, and
 * reused in every tab. A character's photos are its portrait's edits (the photodump). Only
 * photos made here and not personal can become a character: a character is never a real person.
 */
type CharacterPhoto = { imageRef: string; scene: string; jobId?: string; createdAt: string };
type CharacterRecord = {
  id: string;
  name: string;
  type: CharacterType;
  /** Who the character is (absent on the characters made before the kinds). */
  kind?: CharacterKind;
  traits?: CharacterTraits;
  description: string;
  imageRef: string;
  /** The text-to-image job that made the portrait: its history item brings the portrait back in the Studio. */
  jobId?: string;
  /** Or the starting face it was made from: the Studio loads that face again. */
  faceId?: string;
  photos: CharacterPhoto[];
  createdAt: string;
};

export const CHARACTER_NAME_MAX = 40;
export const CHARACTER_DESCRIPTION_MAX = 240;
export const CHARACTER_SCENE_MAX = 500;
export const CHARACTER_PHOTOS_MAX = 60;

const SAFE_ID = /^[a-f0-9-]{36}$/;
const dir = () => join(getEnv().data, 'characters');
const fileOf = (id: string) => join(dir(), `${id}.json`);
const mediaOf = (imageRef: string) => `/media/data/${imageRef}`;

function summary(record: CharacterRecord): CharacterSummary {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    ...(record.kind ? { kind: record.kind } : {}),
    ...(record.traits && Object.keys(record.traits).length > 0 ? { traits: record.traits } : {}),
    ...(record.faceId ? { faceId: record.faceId } : {}),
    description: record.description,
    imageRef: record.imageRef,
    imageUrl: mediaOf(record.imageRef),
    ...(record.jobId
      ? { portraitHistoryKey: `job:${record.jobId}` }
      : record.faceId
        ? { portraitHistoryKey: `${FACE_KEY_PREFIX}${record.faceId}` }
        : {}),
    createdAt: record.createdAt,
    photos: record.photos.map((photo) => ({
      imageRef: photo.imageRef,
      url: mediaOf(photo.imageRef),
      scene: photo.scene,
      ...(photo.jobId ? { historyKey: `job:${photo.jobId}` } : {}),
      createdAt: photo.createdAt,
    })),
  };
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

/**
 * A photo of this machine that shows no real person: made from a text, or edits of such a photo only
 * (the edit carries the mark on from its source; an edit of a sample, a frame or an import has none).
 */
async function assertFictionalPhoto(imageRef: unknown): Promise<string> {
  if (typeof imageRef !== 'string') throw new JobError('invalid-input');
  const meta = await readUploadMeta(imageRef);
  if (!meta) throw new JobError('unknown-image');
  if (meta.personal || meta.fictional !== true) throw new JobError('invalid-input');
  return imageRef;
}

async function read(id: string): Promise<CharacterRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(fileOf(id), 'utf8')) as CharacterRecord;
  } catch {
    return null;
  }
}

export async function listCharacters(): Promise<CharacterSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const records = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => read(name.slice(0, -5))));
  return records
    .filter((record): record is CharacterRecord => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summary);
}

export async function getCharacter(id: string): Promise<CharacterSummary | null> {
  const record = await read(id);
  return record ? summary(record) : null;
}

export async function createCharacter(body: Record<string, unknown>): Promise<CharacterSummary> {
  const name = text(body.name, CHARACTER_NAME_MAX);
  const description = text(body.description, CHARACTER_DESCRIPTION_MAX);
  const type = CHARACTER_TYPES.find((value) => value === body.type);
  // A person when nothing says otherwise; an unknown kind is refused.
  const kind = body.kind === undefined ? 'human' : CHARACTER_KINDS.find((value) => value === body.kind);
  // Known traits only, like the kind.
  const traits = knownTraits(body.traits);
  // A starting face of the bank, by its id; its picture is checked like any other below.
  const faceId = body.faceId === undefined ? undefined : typeof body.faceId === 'string' ? faceById(body.faceId)?.id : undefined;
  if (!name || !description || !type || !kind || !traits || (body.faceId !== undefined && !faceId)) throw new JobError('invalid-input');
  const imageRef = await assertFictionalPhoto(body.imageRef);
  await assertAllowedText(name, description);
  const jobId = typeof body.jobId === 'string' && SAFE_ID.test(body.jobId) ? body.jobId : undefined;
  const record: CharacterRecord = {
    id: randomUUID(),
    name,
    type,
    kind,
    ...(Object.keys(traits).length > 0 ? { traits } : {}),
    description,
    imageRef,
    ...(jobId ? { jobId } : faceId ? { faceId } : {}),
    photos: [],
    createdAt: new Date().toISOString(),
  };
  await mkdir(dir(), { recursive: true });
  await writeAtomic(fileOf(record.id), JSON.stringify(record, null, 2));
  return summary(record);
}

/**
 * One change at a time per character: a photodump's pictures finish together, and each addition
 * reads the record then writes it back, so two in parallel would keep only the last one.
 */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(id: string, change: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(change);
  queues.set(id, next);
  void next.finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  }).catch(() => undefined);
  return next;
}

/** Add a photo of the character (a photodump result); the same photo twice is kept once. */
export async function addCharacterPhoto(id: string, body: Record<string, unknown>): Promise<CharacterSummary | null> {
  if (!SAFE_ID.test(id)) return null;
  const scene = text(body.scene, CHARACTER_SCENE_MAX);
  const imageRef = await assertFictionalPhoto(body.imageRef);
  const jobId = typeof body.jobId === 'string' && SAFE_ID.test(body.jobId) ? body.jobId : undefined;
  return serialized(id, async () => {
    const record = await read(id);
    if (!record) return null;
    if (!scene) throw new JobError('invalid-input');
    if (!record.photos.some((photo) => photo.imageRef === imageRef)) {
      if (record.photos.length >= CHARACTER_PHOTOS_MAX) throw new JobError('invalid-input');
      record.photos.push({ imageRef, scene, ...(jobId ? { jobId } : {}), createdAt: new Date().toISOString() });
      await writeAtomic(fileOf(id), JSON.stringify(record, null, 2));
    }
    return summary(record);
  });
}

/** Forget a character; its photos stay in the history. */
export async function deleteCharacter(id: string): Promise<boolean> {
  return serialized(id, async () => {
    if (!(await read(id))) return false;
    await rm(fileOf(id), { force: true });
    return true;
  });
}
