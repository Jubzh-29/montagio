/**
 * The languages captions are made in: written in the Latin alphabet, every letter of them in the four
 * embedded fonts (checked with fontTools on 2026-10-25, and by apps/web/test/captions-fonts.test.ts).
 * Vietnamese is left out (Poppins and Bebas Neue lack its stacked accents), and so are the languages
 * of other scripts: Japanese and Chinese would need CJK fonts of more than 20 MB and line breaks without spaces.
 */
export const CAPTION_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'ca', 'pl', 'ro', 'sv', 'da', 'no', 'fi', 'cs', 'sk', 'hr', 'sl', 'hu', 'tr', 'id', 'ms'] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

export function isCaptionLanguage(code: unknown): code is CaptionLanguage {
  return typeof code === 'string' && (CAPTION_LANGUAGES as readonly string[]).includes(code);
}
