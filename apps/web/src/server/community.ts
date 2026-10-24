import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  COMMUNITY_AUTHOR_MAX,
  COMMUNITY_TITLE_MAX,
  RECIPE_SCHEMA,
  shareableReprise,
  type CommunityEntry,
  type Recipe,
} from '@/lib/community';
import { getEnv } from './env';
import { JobError } from './errors';
import { extensionsInfo } from './extensions';
import { galleryOrder, presetPosterUrl, presetPreviewUrl } from './gallery';
import { mediaFileFor, mediaUrlFor } from './generations';
import { assertNoBlockedName } from './guards';
import { listHistory } from './history';
import { getServices } from './services';
import { readPresetText, writeAtomic } from './store';

/**
 * The community gallery of this machine: the examples of the catalogue, and the entries published
 * here or imported from a recipe, each a JSON file in MONTAGIO_DATA/community with its media and,
 * for a remixed move, its preset text beside it.
 */
type Stored = CommunityEntry & { source: 'local' | 'imported'; media?: string; presetFile?: string };

const SAFE_ID = /^[a-f0-9-]{36}$/;
const dir = () => join(getEnv().data, 'community');
const fileOf = (id: string) => join(dir(), `${id}.json`);
const presetOf = (id: string) => join(dir(), `${id}.yaml`);

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
};

/** What a stored entry shows: its media and preset files stay on this side. */
function shown(stored: Stored): CommunityEntry {
  const entry: Partial<Stored> = { ...stored };
  delete entry.media;
  delete entry.presetFile;
  return entry as CommunityEntry;
}

async function readStored(id: string): Promise<Stored | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(fileOf(id), 'utf8')) as Stored;
  } catch {
    return null;
  }
}

/** The examples: the catalogue's camera moves and the effects shown here, each on its tab's sample photo. */
async function examples(): Promise<CommunityEntry[]> {
  const lib = await getServices().library;
  const { root } = getEnv();
  const createdAt = new Date(0).toISOString();
  const moves = await Promise.all(
    galleryOrder([...lib.presets.values()]).map(async (preset): Promise<CommunityEntry | null> => {
      const previewUrl = await presetPreviewUrl(root, preset.preview);
      if (!previewUrl) return null;
      const posterUrl = await presetPosterUrl(root, preset.preview);
      return {
        id: `move-${preset.id}`,
        source: 'example',
        title: preset.name,
        author: 'Montagio',
        kind: 'clip',
        task: 'camera',
        name: preset.name,
        previewUrl,
        ...(posterUrl ? { posterUrl } : {}),
        createdAt,
        reprise: { tab: 'camera', presetId: preset.id, sample: true },
      };
    }),
  );
  const effects = (await extensionsInfo()).effects.flatMap((effect): CommunityEntry[] =>
    effect.previewUrl
      ? [
          {
            id: `effect-${effect.id}`,
            source: 'example',
            title: effect.name,
            author: 'Montagio',
            kind: 'clip',
            task: 'effect',
            name: effect.name,
            previewUrl: effect.previewUrl,
            ...(effect.posterUrl ? { posterUrl: effect.posterUrl } : {}),
            createdAt,
            reprise: { tab: 'effects', effectId: effect.id, sample: true },
          },
        ]
      : [],
  );
  return [...moves.filter((entry): entry is CommunityEntry => entry !== null), ...effects];
}

async function storedEntries(): Promise<Stored[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const entries = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readStored(name.slice(0, -'.json'.length))));
  return entries.filter((entry): entry is Stored => entry !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** What was published or imported here, newest first, then the examples. */
export async function listCommunity(): Promise<CommunityEntry[]> {
  return [...(await storedEntries()).map(shown), ...(await examples())];
}

export async function getCommunityEntry(id: string): Promise<CommunityEntry | null> {
  const stored = await readStored(id);
  if (stored) return shown(stored);
  return (await examples()).find((entry) => entry.id === id) ?? null;
}

async function save(stored: Stored): Promise<CommunityEntry> {
  await mkdir(dir(), { recursive: true });
  await writeAtomic(fileOf(stored.id), JSON.stringify(stored, null, 2));
  return shown(stored);
}

/** The title and the author's name, checked as every text the app keeps. */
async function credits(body: Record<string, unknown>): Promise<{ title: string; author?: string }> {
  const title = text(body.title, COMMUNITY_TITLE_MAX);
  const author = body.author === undefined || body.author === '' ? undefined : text(body.author, COMMUNITY_AUTHOR_MAX);
  if (!title || (body.author !== undefined && body.author !== '' && !author)) throw new JobError('invalid-input');
  await assertNoBlockedName(title, author ?? '');
  return { title, ...(author ? { author } : {}) };
}

/**
 * Publish a creation of the history to the gallery: its media is copied (it stays when the history
 * is cleared), with its settings and, for a remixed move, the preset text it was rendered from.
 */
export async function publishToCommunity(body: Record<string, unknown>): Promise<CommunityEntry | null> {
  const key = typeof body.historyKey === 'string' ? body.historyKey : '';
  const item = (await listHistory()).find((entry) => entry.key === key);
  if (!item) return null;
  const { title, author } = await credits(body);
  const id = randomUUID();
  await mkdir(dir(), { recursive: true });
  const source = mediaFileFor(item.downloadUrl);
  let media: string | undefined;
  if (source) {
    media = join(dir(), `${id}${extname(source) || (item.kind === 'photo' ? '.png' : '.mp4')}`);
    await copyFile(source, media);
  }
  let presetFile: string | undefined;
  if (item.reprise.remixGenerationId) {
    const preset = await readPresetText(item.reprise.remixGenerationId);
    if (preset !== null) {
      presetFile = presetOf(id);
      await writeFile(presetFile, preset);
    }
  }
  // The generation id means nothing elsewhere: the preset text is kept beside the entry instead.
  const reprise = { ...item.reprise };
  delete reprise.remixGenerationId;
  const previewUrl = media ? mediaUrlFor(media) : undefined;
  return save({
    id,
    source: 'local',
    title,
    ...(author ? { author } : {}),
    kind: item.kind,
    task: item.task,
    name: item.name,
    ...(previewUrl ? { previewUrl } : {}),
    createdAt: new Date().toISOString(),
    reprise: { ...reprise, ...(presetFile ? { presetUrl: `/api/community/${id}/preset` } : {}) },
    ...(media ? { media } : {}),
    ...(presetFile ? { presetFile } : {}),
  });
}

/** A recipe someone shared, added to this gallery; it shows the example of its move or effect, when there is one. */
export async function importRecipe(recipe: Recipe): Promise<CommunityEntry> {
  await assertNoBlockedName(recipe.title, recipe.author ?? '', recipe.reprise.prompt ?? '', recipe.reprise.motion ?? '');
  const id = randomUUID();
  const example = (await examples()).find(
    (entry) => (recipe.reprise.presetId && entry.reprise.presetId === recipe.reprise.presetId) || (recipe.reprise.effectId && entry.reprise.effectId === recipe.reprise.effectId),
  );
  let presetFile: string | undefined;
  if (recipe.presetYaml) {
    await mkdir(dir(), { recursive: true });
    presetFile = presetOf(id);
    await writeFile(presetFile, recipe.presetYaml);
  }
  return save({
    id,
    source: 'imported',
    title: recipe.title,
    ...(recipe.author ? { author: recipe.author } : {}),
    kind: recipe.kind,
    task: recipe.task,
    name: recipe.name,
    ...(example?.previewUrl ? { previewUrl: example.previewUrl } : {}),
    ...(example?.posterUrl ? { posterUrl: example.posterUrl } : {}),
    createdAt: new Date().toISOString(),
    reprise: { ...recipe.reprise, ...(presetFile ? { presetUrl: `/api/community/${id}/preset` } : {}) },
    ...(presetFile ? { presetFile } : {}),
  });
}

/** The recipe of an entry published or imported here: its settings, without this machine's photo. */
export async function recipeOf(id: string): Promise<Recipe | null> {
  const stored = await readStored(id);
  if (!stored) return null;
  const presetYaml = stored.presetFile ? await readFile(stored.presetFile, 'utf8').catch(() => undefined) : undefined;
  return {
    schema: RECIPE_SCHEMA,
    title: stored.title,
    ...(stored.author ? { author: stored.author } : {}),
    kind: stored.kind,
    task: stored.task,
    name: stored.name,
    reprise: shareableReprise(stored.reprise),
    ...(presetYaml ? { presetYaml } : {}),
    createdAt: stored.createdAt,
  };
}

export async function communityPresetText(id: string): Promise<string | null> {
  const stored = await readStored(id);
  if (!stored?.presetFile) return null;
  return readFile(stored.presetFile, 'utf8').catch(() => null);
}

/** Take an entry out of the gallery, its copied media and preset with it; the examples stay. */
export async function removeFromCommunity(id: string): Promise<boolean> {
  const stored = await readStored(id);
  if (!stored) return false;
  await Promise.all([rm(fileOf(id), { force: true }), ...(stored.media ? [rm(stored.media, { force: true })] : []), ...(stored.presetFile ? [rm(stored.presetFile, { force: true })] : [])]);
  return true;
}
