import type { ModelEntry } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect, type Resolution } from './dimensions';

/**
 * The cinematography of a text-to-image job, as a cinema studio sets it: a camera, a lens, a film
 * look, a light and a palette. Each choice adds a fixed phrase after the text; no brand name, so a
 * photo never imitates a product.
 */
export const IMAGE_STYLES = {
  camera: {
    'cinema': 'shot on a large-format digital cinema camera',
    '16mm': 'shot on a 16mm film camera, visible grain',
    'phone': 'shot on a phone camera, natural handheld look',
    'drone': 'aerial drone shot from high above',
  },
  lens: {
    'wide': '24mm wide-angle lens',
    'normal': '35mm lens, natural perspective',
    'portrait': '85mm portrait lens, shallow depth of field, soft background',
    'anamorphic': 'anamorphic lens, oval bokeh, horizontal lens flares',
    'macro': 'macro lens, extreme close-up detail',
  },
  film: {
    'warm': 'warm soft film colors, fine grain',
    'tungsten': 'tungsten night film, red halation around the lights',
    'slide': 'saturated slide film colors, deep blacks',
    'bw': 'black and white film, rich grain',
  },
  light: {
    'golden': 'golden hour sunlight, long warm shadows',
    'blue': 'blue hour twilight',
    'neon': 'neon lights at night, colored reflections',
    'studio': 'soft studio lighting, clean background light',
    'overcast': 'soft overcast daylight',
    'candle': 'warm candlelight',
    'noon': 'hard midday sun, crisp shadows',
  },
  palette: {
    'teal-orange': 'teal and orange color grading',
    'pastel': 'soft pastel palette',
    'earthy': 'earthy muted tones',
    'vivid': 'vivid saturated colors',
    'mono': 'monochrome palette',
  },
} as const;

export type ImageStyleGroup = keyof typeof IMAGE_STYLES;
export const IMAGE_STYLE_GROUPS = Object.keys(IMAGE_STYLES) as ImageStyleGroup[];
/** One choice per group at most; a group left out adds nothing. */
export type ImageStyle = { [G in ImageStyleGroup]?: keyof (typeof IMAGE_STYLES)[G] & string };

/** The style as a list of known choices, or null when a group or a choice is unknown. */
export function parseImageStyle(raw: unknown): ImageStyle | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const style: Record<string, string> = {};
  for (const [group, choice] of Object.entries(raw as Record<string, unknown>)) {
    if (choice === undefined || choice === null || choice === '') continue;
    const options = IMAGE_STYLES[group as ImageStyleGroup] as Record<string, string> | undefined;
    if (!options || typeof choice !== 'string' || !Object.hasOwn(options, choice)) return null;
    style[group] = choice;
  }
  return style as ImageStyle;
}

/** The text the model reads: the visitor's text, then the phrases of the chosen style, in group order. */
export function styledPrompt(prompt: string, style: ImageStyle = {}): string {
  const phrases = IMAGE_STYLE_GROUPS.flatMap((group) => {
    const choice = style[group];
    return choice ? [(IMAGE_STYLES[group] as Record<string, string>)[choice]!] : [];
  });
  const text = prompt.trim().replace(/[.\s]+$/, '');
  return phrases.length > 0 ? `${text}. ${phrases.join(', ')}.` : prompt.trim();
}

export type ImageInputs = { prompt: string; seed: number; aspect: Aspect; resolution?: Resolution; style?: ImageStyle };
export type ImageParams = { width: number; height: number; prompt: string; seed: number; resolution: Resolution };

/** The longest text a text-to-image job takes. */
export const IMAGE_PROMPT_MAX = 500;

/**
 * Text to image (capability t2i, Z-Image-Turbo at launch): the start photo of a shot,
 * at the size the video models render natively for its aspect (720p by default).
 */
export function compileImage(
  model: ModelEntry,
  template: ApiWorkflow,
  inputs: ImageInputs,
): { workflow: ApiWorkflow; output: { kind: 'image'; node: string }; params: ImageParams } {
  if (!model.capabilities.includes('t2i')) throw new CompileError(`model ${model.id} cannot render capability t2i`);
  const prompt = inputs.prompt.trim();
  if (!prompt) throw new CompileError('a text-to-image job needs a text');
  if (prompt.length > IMAGE_PROMPT_MAX) throw new CompileError(`the text is longer than ${IMAGE_PROMPT_MAX} characters`);
  const resolution = inputs.resolution ?? '720p';
  if (!model.limits.resolutions.includes(resolution)) {
    throw new CompileError(`resolution ${resolution} is not supported by model ${model.id} (allowed: ${model.limits.resolutions.join(', ')})`);
  }
  const savers = Object.entries(template).filter(([, node]) => node.class_type.startsWith('SaveImage'));
  if (savers.length !== 1) {
    throw new CompileError(`the workflow of ${model.id} must have one SaveImage node, it has ${savers.length}`);
  }

  const { width, height } = dimensionsFor(inputs.aspect, resolution);
  const text = styledPrompt(prompt, inputs.style);
  const params: ImageParams = { width, height, prompt: text, seed: inputs.seed, resolution };
  const values: Record<string, unknown> = { prompt: text, seed: inputs.seed, width, height };
  const workflow = structuredClone(template);
  for (const [key, binding] of Object.entries(model.bindings)) {
    if (!binding || !(key in values)) continue;
    const node = workflow[binding.node];
    if (!node) throw new CompileError(`binding ${key} → node ${binding.node} not found in the workflow template of ${model.id}`);
    node.inputs[binding.field] = values[key];
  }
  return { workflow, output: { kind: 'image', node: savers[0]![0] }, params };
}
