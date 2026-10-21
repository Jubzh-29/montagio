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

export type HistoryFilter = 'all' | HistoryItem['kind'];

export function historyFilter(items: HistoryItem[], filter: HistoryFilter): HistoryItem[] {
  return filter === 'all' ? items : items.filter((item) => item.kind === filter);
}
