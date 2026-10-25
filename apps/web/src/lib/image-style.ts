import type { MessageKey } from '@/i18n';

/**
 * The cinematography chips of Text to image. The server holds the phrase of each choice
 * (IMAGE_STYLES in @montagio/presets, which the browser does not load); a test keeps both lists equal.
 */
export const STYLE_CHOICES = {
  camera: ['cinema', '16mm', 'phone', 'drone'],
  lens: ['wide', 'normal', 'portrait', 'anamorphic', 'macro'],
  film: ['warm', 'tungsten', 'slide', 'bw'],
  light: ['golden', 'blue', 'neon', 'studio', 'overcast', 'candle', 'noon'],
  palette: ['teal-orange', 'pastel', 'earthy', 'vivid', 'mono'],
} as const;

export type StyleGroup = keyof typeof STYLE_CHOICES;
export const STYLE_GROUPS = Object.keys(STYLE_CHOICES) as StyleGroup[];
export type StyleSelection = Partial<Record<StyleGroup, string>>;

const camel = (id: string) => id.replace(/(^|-)(\w)/g, (_, __, letter: string) => letter.toUpperCase());

export const styleGroupKey = (group: StyleGroup) => `styleGroup${camel(group)}` as MessageKey;
export const styleChoiceKey = (group: StyleGroup, choice: string) => `style${camel(group)}${camel(choice)}` as MessageKey;

/** The selection as the request sends it: the chosen groups only. */
export function styleBody(selection: StyleSelection): StyleSelection {
  return Object.fromEntries(Object.entries(selection).filter(([, choice]) => Boolean(choice)));
}

/**
 * Relight: a new light on the photo, as a ready-made instruction for the photo edit (Qwen-Image-Edit
 * relights from words alone, no extra weights). The visitor can still change the text before applying.
 */
export const RELIGHTS = ['golden', 'blue', 'neon', 'studio', 'backlight', 'candle'] as const;
export type Relight = (typeof RELIGHTS)[number];

const RELIGHT_LIGHT: Record<Relight, string> = {
  golden: 'warm golden hour sunlight coming from the side, long soft shadows',
  blue: 'cool blue hour twilight, soft ambient light',
  neon: 'colorful neon lights at night, pink and blue reflections',
  studio: 'soft even studio lighting, a large softbox in front',
  backlight: 'a strong sunset backlight with a glowing rim around the subject',
  candle: 'warm flickering candlelight from below',
};

export function relightInstruction(relight: Relight): string {
  return `Relight the photo with ${RELIGHT_LIGHT[relight]}. Keep the people, the objects, the framing and the composition exactly the same.`;
}

export const relightKey = (relight: Relight) => `relight${camel(relight)}` as MessageKey;

/**
 * Change color palette: the photo recolored with a ready-made palette, or with the colors of another
 * photo (the edit's second image). Like Relight, a ready-made instruction the visitor can still change.
 */
export const PALETTES = ['sunset', 'tealOrange', 'pastel', 'noir', 'forest', 'neon', 'earth', 'ocean'] as const;
export type Palette = (typeof PALETTES)[number];

/** Each palette's colors: the swatches on its chip, and the words the edit reads. */
export const PALETTE_COLORS: Record<Palette, { swatches: readonly string[]; words: string }> = {
  sunset: { swatches: ['#ff7f6b', '#ffc49b', '#f2b134', '#6b3a5b'], words: 'warm sunset palette of coral, peach, gold and plum' },
  tealOrange: { swatches: ['#127c7c', '#3fb8af', '#ff9f43', '#f26b1d'], words: 'cinematic teal and orange palette' },
  pastel: { swatches: ['#f7c5d9', '#bfe8d6', '#cdbcf2', '#fff1b3'], words: 'soft pastel palette of pink, mint, lavender and butter yellow' },
  noir: { swatches: ['#111111', '#7a7a7a', '#f2f2f2', '#c1121f'], words: 'black and white palette with a single touch of deep red' },
  forest: { swatches: ['#2f5233', '#7a8b3c', '#efe6cf', '#6b4a2b'], words: 'forest palette of moss green, olive, cream and bark brown' },
  neon: { swatches: ['#ff2fb3', '#24f0ff', '#8a2cff', '#0b0b23'], words: 'neon palette of magenta, cyan and electric purple on deep night blue' },
  earth: { swatches: ['#c4622d', '#e3c9a0', '#7d7a3c', '#f5ecd9'], words: 'earthy palette of terracotta, sand, olive and cream' },
  ocean: { swatches: ['#0b2545', '#13a3b2', '#8de4e8', '#f7fbfc'], words: 'ocean palette of navy, turquoise, aqua and white' },
};

const KEEP = 'Keep the people, the objects, the light direction, the framing and the composition exactly the same; change only the colors.';

export function paletteInstruction(palette: Palette): string {
  return `Recolor the photo with a ${PALETTE_COLORS[palette].words}. ${KEEP}`;
}

/** The colors of a second photo, sent as the edit's image 2. */
export const PALETTE_FROM_PHOTO_INSTRUCTION =
  "Recolor image 1 with the color palette of image 2. Keep image 1's people, objects, light direction, framing and composition exactly the same; take only the colors from image 2.";

export const paletteKey = (palette: Palette) => `palette${camel(palette)}` as MessageKey;

/**
 * Moodboard: the picture made from the text, then restyled with the look of a sheet of reference
 * pictures (the edit's image 2): their palette, light, texture and mood, never their content.
 */
export const MOODBOARD_INSTRUCTION =
  'Restyle image 1 with the look of the moodboard in image 2: its color palette, lighting, texture and mood. Keep the subjects, shapes and composition of image 1; copy nothing else from image 2.';
export const MOODBOARD_REFS_MAX = 4;
