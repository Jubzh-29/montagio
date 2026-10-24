import type { Lang } from '@/i18n';
import { CATALOG_FR } from '@/i18n/catalog-fr';
import type { HistoryItem } from './api-types';

/** What the Studio sets back from a history item. */
export type StudioRestore = {
  tab: HistoryItem['reprise']['tab'];
  photo?: { imageRef: string; personal: boolean };
  /** A photo made from a text: its text, for an effect's subject. */
  photoPrompt?: string;
  presetId?: string;
  effectId?: string;
  hookId?: string;
  /** What an effect's photo shows. */
  subject?: string;
  /** The scene text of a camera move. */
  prompt?: string;
  /** A motion transfer's reference clip (when it is still there) and its two texts. */
  motion?: { videoRef?: string; character: string; action: string };
  /** A restyle: its clip (when it is still there), its text, and its look image (when there was one and it is still there). */
  restyle?: { videoRef?: string; text: string; look?: { imageRef: string; personal: boolean } };
  /** An object swap: its clip (when it is still there), its text, and its new object's photo (when there was one); the object is painted again. */
  swap?: { videoRef?: string; text: string; photo?: { imageRef: string; personal: boolean } };
  /** What an avatar says, and in which language. */
  speech?: { text: string; language: 'en' | 'fr' };
  modelId?: string;
  shots?: { presetId: string; prompt: string }[];
  remixGenerationId?: string;
  notice?: 'photo-missing';
};

/** The Studio, on the item's tab, told which item to bring back. */
export function repriseHref(item: HistoryItem): string {
  return `/?tab=${item.reprise.tab}&from=${encodeURIComponent(item.key)}`;
}

export function applyReprise(item: HistoryItem): StudioRestore {
  const { reprise } = item;
  const restore: StudioRestore = { tab: reprise.tab };
  if (reprise.restyle) {
    // The Motion tab in its restyle mode: the image is the look to follow, never the start photo.
    restore.restyle = {
      ...(reprise.videoRef ? { videoRef: reprise.videoRef } : {}),
      text: reprise.prompt ?? '',
      ...(reprise.imageRef ? { look: { imageRef: reprise.imageRef, personal: reprise.personal ?? true } } : {}),
    };
    return restore;
  }
  if (reprise.swap) {
    // The Motion tab in its swap mode: the image is the new object, never the start photo.
    restore.swap = {
      ...(reprise.videoRef ? { videoRef: reprise.videoRef } : {}),
      text: reprise.prompt ?? '',
      ...(reprise.imageRef ? { photo: { imageRef: reprise.imageRef, personal: reprise.personal ?? true } } : {}),
    };
    return restore;
  }
  if (reprise.imageRef) restore.photo = { imageRef: reprise.imageRef, personal: reprise.personal ?? true };
  if (reprise.photoMissing) restore.notice = 'photo-missing';
  if (reprise.presetId) restore.presetId = reprise.presetId;
  if (reprise.modelId) restore.modelId = reprise.modelId;
  if (reprise.remixGenerationId) restore.remixGenerationId = reprise.remixGenerationId;
  if (reprise.shots) restore.shots = reprise.shots.map((shot) => ({ presetId: shot.presetId, prompt: shot.prompt ?? '' }));
  if (reprise.effectId) restore.effectId = reprise.effectId;
  if (reprise.hookId) restore.hookId = reprise.hookId;
  if (reprise.prompt) {
    // The same field means five things: the text a photo was made from, an effect's subject, an
    // avatar's speech, a motion's character (below, with the clip), a scene.
    if (item.kind === 'photo') restore.photoPrompt = reprise.prompt;
    else if (reprise.tab === 'avatar') restore.speech = { text: reprise.prompt, language: reprise.language ?? 'en' };
    else if (reprise.tab === 'effects') restore.subject = reprise.prompt;
    else if (reprise.tab !== 'motion') restore.prompt = reprise.prompt;
  }
  if (reprise.tab === 'motion') {
    restore.motion = { ...(reprise.videoRef ? { videoRef: reprise.videoRef } : {}), character: reprise.prompt ?? '', action: reprise.motion ?? '' };
  }
  return restore;
}

/**
 * The name of what made an item, in the interface's language: its move, effect or hook, its film's
 * moves, with the HD and music marks the server adds; anything else keeps the server's name.
 */
export function historyName(item: HistoryItem, lang: Lang): string {
  if (lang !== 'fr') return item.name;
  const { reprise } = item;
  const nameOf = (id: string) => CATALOG_FR[id]?.name;
  const id = reprise.effectId ?? reprise.hookId ?? reprise.presetId;
  const base = reprise.shots?.length
    ? reprise.shots.map((shot) => nameOf(shot.presetId) ?? shot.presetId).join(' → ')
    : id
      ? nameOf(id)
      : undefined;
  if (!base) return item.name;
  return item.task === 'upscale' ? `${base} · HD` : item.task === 'music' ? `${base} ♪` : base;
}

/** What a card is titled by: what was asked (a scene, a subject, a speech, a text), when there is one. */
export function historySubject(item: HistoryItem): string | undefined {
  return item.reprise.prompt?.trim() || undefined;
}

export type HistoryFilter = 'all' | HistoryItem['kind'];

export function historyFilter(items: HistoryItem[], filter: HistoryFilter): HistoryItem[] {
  return filter === 'all' ? items : items.filter((item) => item.kind === filter);
}
