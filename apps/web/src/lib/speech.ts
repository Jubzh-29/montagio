/** Characters spoken per second, as the composer estimates them: a rough pace, not a rule of the server. */
const PACE: Record<'en' | 'fr', number> = { en: 15, fr: 13 };

/** How long the avatar's voice may last, in seconds rounded to the tenth: the real voice decides. */
export function estimateSpeech(text: string, language: 'en' | 'fr'): number {
  return Math.round((text.trim().length / PACE[language]) * 10) / 10;
}
