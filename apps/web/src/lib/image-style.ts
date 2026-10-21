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
