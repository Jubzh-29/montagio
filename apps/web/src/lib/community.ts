import type { HistoryItem, Reprise } from './api-types';

/**
 * The community gallery: creations shown with the settings that made them, remixed in one click.
 * No account and no public server: a creation is published to this machine's gallery, and shared
 * as a share file (its settings, never a photo) that anyone imports into theirs. The examples are
 * the catalogue's moves and effects; in the static showcase, its rendered clips.
 */
export type CommunitySource = 'example' | 'local' | 'imported';

export type CommunityEntry = {
  id: string;
  source: CommunitySource;
  title: string;
  author?: string;
  kind: HistoryItem['kind'];
  task: HistoryItem['task'];
  /** What made it: the move, the effect, the model. */
  name: string;
  previewUrl?: string;
  posterUrl?: string;
  createdAt: string;
  /** The settings the Studio sets back when the entry is remixed. */
  reprise: Reprise;
};

/** A share file: a creation's settings, shared by hand (a chat, a forum, a pull request). */
export type SharedEntry = {
  schema: 'montagio/share@0.1';
  title: string;
  author?: string;
  kind: HistoryItem['kind'];
  task: HistoryItem['task'];
  name: string;
  reprise: Reprise;
  /** A remixed camera move: its preset text, reopened in the remix editor. */
  presetYaml?: string;
  createdAt: string;
};

export const SHARE_SCHEMA = 'montagio/share@0.1';
export const COMMUNITY_TITLE_MAX = 80;
export const COMMUNITY_AUTHOR_MAX = 40;
export const SHARE_TEXT_MAX = 500;
export const SHARE_PRESET_MAX = 64 * 1024;

const TABS: readonly Reprise['tab'][] = ['effects', 'camera', 'film', 'avatar', 'motion'];
const KINDS: readonly HistoryItem['kind'][] = ['photo', 'clip', 'film'];
const TASKS: readonly HistoryItem['task'][] = ['camera', 'film', 't2i', 'edit', 'effect', 'hook', 'avatar', 'music', 'upscale', 'image-upscale', 'motion', 'ad', 'voice-change', 'moodboard'];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const communityKey = (id: string) => `community:${id}`;

/** The Studio, on the entry's tab, told to bring that entry back. */
export const communityHref = (entry: Pick<CommunityEntry, 'id' | 'reprise'>) => `/?tab=${entry.reprise.tab}&from=${encodeURIComponent(communityKey(entry.id))}`;

/** An entry as the Studio's "Reuse" reads a history item. */
export function entryAsHistoryItem(entry: CommunityEntry): HistoryItem {
  return {
    key: communityKey(entry.id),
    source: 'community',
    kind: entry.kind,
    task: entry.task,
    name: entry.name,
    modelName: entry.name,
    createdAt: entry.createdAt,
    previewUrl: entry.previewUrl ?? '',
    downloadUrl: entry.previewUrl ?? '',
    reprise: entry.reprise,
  };
}

/**
 * The part of a reprise a share file carries: the settings, never this machine's photo, clip or ids.
 * Without its photo the Studio starts from its sample photo, and the visitor can change it.
 */
export function shareableReprise(reprise: Reprise): Reprise {
  const shared: Reprise = { tab: reprise.tab, sample: true };
  if (reprise.presetId) shared.presetId = reprise.presetId;
  if (reprise.effectId) shared.effectId = reprise.effectId;
  if (reprise.hookId) shared.hookId = reprise.hookId;
  if (reprise.prompt) shared.prompt = reprise.prompt;
  if (reprise.language) shared.language = reprise.language;
  if (reprise.motion) shared.motion = reprise.motion;
  if (reprise.modelId) shared.modelId = reprise.modelId;
  if (reprise.shots) shared.shots = reprise.shots.map((shot) => ({ presetId: shot.presetId, ...(shot.prompt ? { prompt: shot.prompt } : {}) }));
  return shared;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
};
const id = (value: unknown): string | undefined => (typeof value === 'string' && ID.test(value) ? value : undefined);

/** A share file read from someone: known fields only, each checked; null when it is not one. */
export function parseShared(raw: unknown): SharedEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.schema !== SHARE_SCHEMA) return null;
  const title = text(input.title, COMMUNITY_TITLE_MAX);
  const kind = KINDS.find((value) => value === input.kind);
  const task = TASKS.find((value) => value === input.task);
  const name = text(input.name, COMMUNITY_TITLE_MAX);
  const reprise = input.reprise as Record<string, unknown> | undefined;
  const tab = TABS.find((value) => value === reprise?.tab);
  if (!title || !kind || !task || !name || !reprise || typeof reprise !== 'object' || !tab) return null;
  const author = input.author === undefined ? undefined : text(input.author, COMMUNITY_AUTHOR_MAX);
  if (input.author !== undefined && !author) return null;
  const shots = Array.isArray(reprise.shots)
    ? reprise.shots.slice(0, 12).map((shot) => (typeof shot === 'object' && shot ? shot as Record<string, unknown> : {}))
    : undefined;
  const settings: Reprise = {
    tab,
    ...(id(reprise.presetId) ? { presetId: id(reprise.presetId)! } : {}),
    ...(id(reprise.effectId) ? { effectId: id(reprise.effectId)! } : {}),
    ...(id(reprise.hookId) ? { hookId: id(reprise.hookId)! } : {}),
    ...(id(reprise.modelId) ? { modelId: id(reprise.modelId)! } : {}),
    ...(text(reprise.prompt, SHARE_TEXT_MAX) ? { prompt: text(reprise.prompt, SHARE_TEXT_MAX)! } : {}),
    ...(reprise.language === 'en' || reprise.language === 'fr' ? { language: reprise.language } : {}),
    ...(text(reprise.motion, SHARE_TEXT_MAX) ? { motion: text(reprise.motion, SHARE_TEXT_MAX)! } : {}),
    ...(shots && shots.every((shot) => id(shot.presetId))
      ? { shots: shots.map((shot) => ({ presetId: shot.presetId as string, ...(text(shot.prompt, SHARE_TEXT_MAX) ? { prompt: text(shot.prompt, SHARE_TEXT_MAX)! } : {}) })) }
      : {}),
    sample: true,
  };
  const presetYaml = typeof input.presetYaml === 'string' && input.presetYaml.length <= SHARE_PRESET_MAX ? input.presetYaml : undefined;
  if (input.presetYaml !== undefined && presetYaml === undefined) return null;
  if (presetYaml && !settings.presetId) return null;
  const createdAt = typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : new Date().toISOString();
  return { schema: SHARE_SCHEMA, title, ...(author ? { author } : {}), kind, task, name, reprise: settings, ...(presetYaml ? { presetYaml } : {}), createdAt };
}

/** The file name a share file downloads as: its title, readable, then ".montagio-share.json". */
export function shareFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${slug || 'shared'}.montagio-share.json`;
}
