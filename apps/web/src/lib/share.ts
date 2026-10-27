import type { MessageKey } from '@/i18n';
import type { JobTask } from './api-types';

/** What a shared result is, for its caption: its first line and one of its hashtags. */
export type ShareKind = 'camera' | 'effect' | 'film' | 'ad' | 'avatar' | 'motion' | 'restyle' | 'swap' | 'voice' | 'translate' | 'remix' | 'clip';

const LEAD: Record<ShareKind, MessageKey> = {
  camera: 'shareLeadCamera',
  effect: 'shareLeadEffect',
  film: 'shareLeadFilm',
  ad: 'shareLeadAd',
  avatar: 'shareLeadAvatar',
  motion: 'shareLeadMotion',
  restyle: 'shareLeadRestyle',
  swap: 'shareLeadSwap',
  voice: 'shareLeadVoice',
  translate: 'shareLeadTranslate',
  remix: 'shareLeadRemix',
  clip: 'shareLeadClip',
};

const TAG: Record<ShareKind, string> = {
  camera: 'cameramove',
  effect: 'vfx',
  film: 'shortfilm',
  ad: 'productvideo',
  avatar: 'talkingphoto',
  motion: 'dance',
  restyle: 'restyle',
  swap: 'vfx',
  voice: 'voiceover',
  translate: 'dubbing',
  remix: 'trend',
  clip: 'aivideo',
};

/** The kind of a job's clip; a captions export shares as the clip it was made from (`parentTask`). */
export function shareKindOfTask(task: JobTask, parentTask?: JobTask): ShareKind {
  switch (task === 'captions' && parentTask ? parentTask : task) {
    case 'effect':
    case 'hook':
      return 'effect';
    case 'avatar':
      return 'avatar';
    case 'motion':
      return 'motion';
    case 'restyle':
      return 'restyle';
    case 'swap':
      return 'swap';
    case 'ad':
      return 'ad';
    case 'voice-change':
      return 'voice';
    case 'translate':
      return 'translate';
    case 'remix':
      return 'remix';
    case 'music':
      return 'film';
    default:
      return 'clip';
  }
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * The caption proposed with a shared clip, written here from what the result is (no service is asked): what it
 * shows, the AI mention with the model that made it, then the hashtags, #AIgenerated first.
 */
export function shareCaption(t: Translate, opts: { kind: ShareKind; title?: string; model?: { name: string; license: string } }): string {
  const title = opts.title?.trim() || t('shareUntitled');
  const lead = t(LEAD[opts.kind], { title });
  const ai = opts.model ? t('shareAiLine', { model: opts.model.name, license: opts.model.license }) : t('shareAiLineGeneric');
  const tags = ['AIgenerated', 'Montagio', 'opensource', TAG[opts.kind]];
  return `${lead}\n${ai}\n\n${tags.map((tag) => `#${tag}`).join(' ')}`;
}
