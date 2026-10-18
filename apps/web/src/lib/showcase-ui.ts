import type { MessageKey } from '@/i18n';

/**
 * The label of the Studio's main button. The showcase plays pre-generated clips,
 * so it shows a clip or assembles a film instead of generating; it renders no
 * remix, so a remix gets no button there (the Studio explains why instead).
 */
export function primaryLabelKey(mode: 'single' | 'sequence', remix: boolean, showcase: boolean): MessageKey | null {
  if (remix) return showcase ? null : 'generateRemix';
  if (showcase) return mode === 'single' ? 'showcaseShowClip' : 'showcaseAssembleFilm';
  return mode === 'single' ? 'generate' : 'generateFilm';
}

/** The showcase's note under the sample photos: one more sentence while some clips are placeholders. */
export function showcaseNoteKeys(placeholders: boolean): MessageKey[] {
  return placeholders ? ['showcaseNote', 'showcasePlaceholderNote'] : ['showcaseNote'];
}
