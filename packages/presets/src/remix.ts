import type { ExtensionModel } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { bindExtension, requireNodes, type ExtensionCompiled } from './extensions';

/** The nodes the compiler binds: the sheet of the shots, the instruction of the post's pass. */
const SKELETON_NODES = { sheet: '1', instruction: '4' } as const;

/** The languages a remix's post is written in: the app's. */
export const REMIX_POST_LANGUAGES = { en: 'English', fr: 'French' } as const;
export type RemixPostLanguage = keyof typeof REMIX_POST_LANGUAGES;

/** What Gemma reads of a trend: a line per shot, the hook written on screen, the tone. */
export type TrendSkeleton = { shots: string[]; hook: string; style: string };
/** What it writes for the remix: a caption, hashtags (without "#"), a hook to write on screen. */
export type TrendPost = { caption: string; hashtags: string[]; onscreen: string };

/** The longest character description the instruction takes. */
export const REMIX_CHARACTER_MAX = 200;

/**
 * The instruction of the post's pass, put before the skeleton: who performs the shots now, the
 * language, the shape of the answer, and what the post never does (name a real person or a brand).
 */
export function trendPostInstruction(opts: { character?: string; language: RemixPostLanguage }): string {
  const who = opts.character?.trim() ? opts.character.trim() : 'a new character';
  const language = REMIX_POST_LANGUAGES[opts.language];
  return (
    `Here is the description of a short trend video. Write the post of a remix of it in which ${who} performs the same shots, ` +
    `in the same tone. Answer as JSON only, with no other text: {"caption": "one or two short sentences in ${language}", ` +
    `"hashtags": ["five hashtags, without #"], "onscreen": "a short hook to write on screen, in ${language}"}. ` +
    'Never name a real person or a brand.'
  );
}

/**
 * The skeleton and the post of a trend (Gemma 4 E4B, two passes): the sheet of its shots' first
 * frames, as the backend's loader names it once uploaded, and the instruction of the post.
 */
export function compileTrendSkeleton(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { sheetRef: string; character?: string; language: RemixPostLanguage },
): ExtensionCompiled<{ language: RemixPostLanguage; character: string | null }> {
  if (model.task !== 'i2t-trend') throw new CompileError(`model ${model.id} runs task ${model.task}, not i2t-trend`);
  requireNodes(model, template, Object.values(SKELETON_NODES));
  if (!(inputs.language in REMIX_POST_LANGUAGES)) throw new CompileError(`a remix's post is written in English or French, not "${inputs.language}"`);
  const character = inputs.character?.trim() || null;
  if (character && character.length > REMIX_CHARACTER_MAX) {
    throw new CompileError(`the character's description has ${character.length} characters, over the ${REMIX_CHARACTER_MAX} a remix takes`);
  }
  const workflow = bindExtension(model, template, {
    image: inputs.sheetRef,
    prompt: trendPostInstruction({ ...(character ? { character } : {}), language: inputs.language }),
  });
  return { workflow, output: { ...model.output }, params: { language: inputs.language, character } };
}

/** The first JSON object of a model's answer: it may come in a code fence or after a sentence. */
function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Hashtags as a post takes them: words without "#" nor spaces, each once, eight at most. */
export function cleanHashtags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = value.replace(/[\s#]+/g, '').slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === 8) break;
  }
  return tags;
}

/**
 * The skeleton and the post out of the workflow's text file: the two answers apart by a line of
 * "=", each a JSON object perhaps wrapped in words. What cannot be read comes back empty, never thrown:
 * the user writes the post then.
 */
export function parseTrendSkeleton(file: string): { skeleton: TrendSkeleton; post: TrendPost } {
  const [first = '', second = ''] = file.split(/\n=+\n/);
  const skeleton = jsonIn(first) ?? {};
  const post = jsonIn(second) ?? {};
  return {
    skeleton: {
      shots: Array.isArray(skeleton.shots) ? skeleton.shots.filter((line): line is string => typeof line === 'string').map((line) => line.trim().slice(0, 200)).filter(Boolean).slice(0, 16) : [],
      hook: text(skeleton.hook, 200),
      style: text(skeleton.style, 120),
    },
    post: { caption: text(post.caption, 600), hashtags: cleanHashtags(post.hashtags), onscreen: text(post.onscreen, 120) },
  };
}
