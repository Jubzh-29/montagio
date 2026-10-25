import { CAPTION_LANGUAGES, CAPTION_TEXT_MAX, type CaptionStyleId } from '@montagio/captions';
import type { MessageKey } from '@/i18n';

export { CAPTION_TEXT_MAX };

/** The language menu: Whisper detects it, or the user imposes one of the languages captions are made in. */
export const CAPTION_LANGUAGE_CHOICES = ['auto', ...CAPTION_LANGUAGES] as const;

export const STYLE_LABEL: Record<CaptionStyleId, MessageKey> = {
  karaoke: 'captionsStyleKaraoke',
  pop: 'captionsStylePop',
  word: 'captionsStyleWord',
  classic: 'captionsStyleClassic',
  neon: 'captionsStyleNeon',
};

/** A language by its name in the interface's language ("French", "français"); an unknown code stays as it is. */
export function languageLabel(code: string, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language', fallback: 'code' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Export 9:16 is offered for a text that is not blank nor too long, in a language captions are made in, once no export runs. */
export function canExport({ text, supported, busy }: { text: string; supported: boolean; busy: boolean }): boolean {
  return supported && !busy && text.trim().length > 0 && text.length <= CAPTION_TEXT_MAX;
}
