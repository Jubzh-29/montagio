/**
 * The languages a clip is translated into, each by its own name (the header's EN | FR is the
 * interface's language, not the clip's). TRANSLATE_LANGUAGES of @montagio/presets, which the browser
 * does not load; a test keeps both lists equal.
 */
export const TRANSLATE_CHOICES = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['ja', '日本語'],
  ['zh', '中文'],
] as const;
export type TranslateChoice = (typeof TRANSLATE_CHOICES)[number][0];
