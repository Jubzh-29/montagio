import type { LineRules } from './segment';

/** A caption font: its family name inside the TTF (what the ASS script asks libass for), its file, and whether it is the bold face. */
export type CaptionFont = { family: string; file: string; bold: boolean };

/** The fonts embedded in apps/web/public/fonts/captions (OFL, see the README there): never fetched at render time. */
export const CAPTION_FONTS = [
  { family: 'Poppins', file: 'Poppins-Bold.ttf', bold: true },
  { family: 'Anton', file: 'Anton-Regular.ttf', bold: false },
  { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', bold: false },
  { family: 'Montserrat', file: 'Montserrat-Bold.ttf', bold: true },
] as const satisfies readonly CaptionFont[];

const font = (family: (typeof CAPTION_FONTS)[number]['family']): CaptionFont => CAPTION_FONTS.find((entry) => entry.family === family)!;

export const CAPTION_STYLE_IDS = ['karaoke', 'pop', 'word', 'classic', 'neon'] as const;
export type CaptionStyleId = (typeof CAPTION_STYLE_IDS)[number];

/**
 * A caption style, after RushGlide's presets and draw functions: karaoke (drawKaraoke, the karaoke
 * preset's Poppins and yellow sweep), pop (drawCapcutBold's 1 to 3 words with the pop transition),
 * word (the wordByWord transition with stampDown), classic (drawClassic's box) and neon (drawNeonGlow).
 * Sizes are in pixels of the 1080x1920 frame; `rules` cut the words into lines.
 */
export type CaptionStyle = { id: CaptionStyleId; font: CaptionFont; size: number; uppercase: boolean; rules: LineRules };

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyle> = {
  karaoke: { id: 'karaoke', font: font('Poppins'), size: 92, uppercase: false, rules: { maxWords: 6, maxChars: 26, pause_s: 0.5, hold_s: 0.3 } },
  pop: { id: 'pop', font: font('Anton'), size: 120, uppercase: true, rules: { maxWords: 3, maxChars: 16, pause_s: 0.5, hold_s: 0.2 } },
  word: { id: 'word', font: font('Bebas Neue'), size: 170, uppercase: true, rules: { maxWords: 1, maxChars: 14, pause_s: 0.5, hold_s: 0.1 } },
  classic: { id: 'classic', font: font('Montserrat'), size: 76, uppercase: false, rules: { maxWords: 8, maxChars: 40, pause_s: 0.6, hold_s: 0.4 } },
  neon: { id: 'neon', font: font('Bebas Neue'), size: 130, uppercase: true, rules: { maxWords: 4, maxChars: 18, pause_s: 0.5, hold_s: 0.3 } },
};

export function isCaptionStyle(id: unknown): id is CaptionStyleId {
  return typeof id === 'string' && (CAPTION_STYLE_IDS as readonly string[]).includes(id);
}
