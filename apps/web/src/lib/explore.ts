import type { MessageKey } from '@/i18n';
import type { ExtensionsInfo, PresetSummary } from './api-types';
import { tabHref } from './tabs';

/** A card of the Explore page: a tool or a featured format, with its looping preview when one exists. */
export type ExploreCard = {
  id: string;
  href: string;
  name: MessageKey;
  description: MessageKey;
  previewUrl?: string;
  /** Shown instead of a preview. */
  icon: string;
};

type WithPreview = { id: string; previewUrl?: string };

/** The preview of `id`, else the first one the list has: a card never shows a missing file. */
function previewOf(list: readonly WithPreview[], id: string): string | undefined {
  return list.find((item) => item.id === id)?.previewUrl ?? list.find((item) => item.previewUrl)?.previewUrl;
}

/** The three formats the page opens on: camera moves, effects, hooks (each only when the Studio shows it). */
export function featuredCards(presets: readonly PresetSummary[], info: ExtensionsInfo | null): ExploreCard[] {
  const cards: ExploreCard[] = [
    {
      id: 'camera',
      href: tabHref('camera'),
      name: 'exploreFeatCameraName',
      description: 'exploreFeatCameraText',
      previewUrl: previewOf(presets, 'drift-left-push'),
      icon: '◎',
    },
  ];
  if (info && info.effects.length > 0) {
    cards.push({
      id: 'effects',
      href: tabHref('effects'),
      name: 'exploreFeatEffectsName',
      description: 'exploreFeatEffectsText',
      previewUrl: previewOf(info.effects, 'squish'),
      icon: '✦',
    });
  }
  if (info && info.hooks.length > 0) {
    cards.push({
      id: 'hooks',
      href: tabHref('effects'),
      name: 'exploreFeatHooksName',
      description: 'exploreFeatHooksText',
      previewUrl: previewOf(info.hooks, 'ignite'),
      icon: '◎',
    });
  }
  return cards;
}

/** Every tool of the app, in the order a first visit discovers them; an extension's tool only when it is shown. */
export function exploreTools(presets: readonly PresetSummary[], info: ExtensionsInfo | null, showcase = false): ExploreCard[] {
  const has = (id: ExtensionsInfo['extensions'][number]) => Boolean(info?.extensions.includes(id));
  const tools: (ExploreCard | false)[] = [
    { id: 'camera', href: tabHref('camera'), name: 'tabCamera', description: 'exploreCameraText', previewUrl: previewOf(presets, 'slow-push'), icon: '◎' },
    Boolean(info && info.effects.length > 0) && {
      id: 'effects',
      href: tabHref('effects'),
      name: 'tabEffects',
      description: 'exploreEffectsText',
      previewUrl: previewOf(info?.effects ?? [], 'snap-zoom'),
      icon: '✦',
    },
    { id: 'film', href: tabHref('film'), name: 'tabFilm', description: 'exploreFilmText', previewUrl: previewOf(presets, 'pull-back-reveal'), icon: '▤' },
    !showcase && { id: 'characters', href: '/characters', name: 'tabCharacters', description: 'exploreCharactersText', icon: '☺' },
    { id: 'community', href: '/community', name: 'tabCommunity', description: 'exploreCommunityText', icon: '⟳' },
    !showcase && has('edit') && has('music') && { id: 'ads', href: '/ads', name: 'tabAds', description: 'exploreAdsText', icon: '▶' },
    has('avatar') && { id: 'avatar', href: tabHref('avatar'), name: 'tabAvatar', description: 'exploreAvatarText', icon: '◉' },
    !showcase && has('avatar') && Boolean(info?.estimates.translate) && { id: 'translate', href: '/translate', name: 'tabTranslate', description: 'exploreTranslateText', icon: '文A' },
    !showcase && has('avatar') && Boolean(info?.estimates.voiceChange) && { id: 'voice', href: '/voice', name: 'tabVoice', description: 'exploreVoiceText', icon: '≈' },
    has('motion') && { id: 'motion', href: tabHref('motion'), name: 'tabMotion', description: 'exploreMotionText', icon: '⇄' },
    has('restyle') && {
      id: 'restyle',
      href: `${tabHref('motion')}&mode=restyle`,
      name: 'restyleTitle',
      description: 'exploreRestyleText',
      previewUrl: info?.examples?.restyle?.previewUrl,
      icon: '◐',
    },
    has('swap') && {
      id: 'swap',
      href: `${tabHref('motion')}&mode=swap`,
      name: 'swapTitle',
      description: 'exploreSwapText',
      previewUrl: info?.examples?.swap?.previewUrl,
      icon: '⇋',
    },
    { id: 't2i', href: tabHref('camera'), name: 'exploreT2iName', description: 'exploreT2iText', icon: 'Aa' },
    has('edit') && { id: 'edit', href: tabHref('camera'), name: 'exploreEditName', description: 'exploreEditText', icon: '✎' },
    has('upscale') && { id: 'hd', href: '/history', name: 'exploreHdName', description: 'exploreHdText', icon: 'HD' },
    has('music') && { id: 'music', href: tabHref('film'), name: 'exploreMusicName', description: 'exploreMusicText', icon: '♪' },
    { id: 'comfy', href: '/history', name: 'exploreComfyName', description: 'exploreComfyText', icon: '{ }' },
  ];
  return tools.filter((tool): tool is ExploreCard => Boolean(tool));
}
