// What the Recipe panel shows, worked out without React: one row per fact, in reading order.
import type { Recipe } from '@montagio/recipe';
import { catalogName, type Lang, type MessageKey } from '@/i18n';
import { stackHref } from './open-stack';

/** A row of the panel: its label, and its value as text or as a message (a sha256 not recorded). */
export type RecipeRow = { key: MessageKey; value?: string; valueKey?: MessageKey; mono?: true };

/** The start and the end of a sha256, enough to compare two by eye. */
export const shortSha = (sha: string | null | undefined): string | null => (sha ? `${sha.slice(0, 8)}…${sha.slice(-10)}` : null);

/** The marks the server adds to a name: an HD clip, a film with music. */
const MARKS = / · HD$| ♪$/;

export function recipeRows(recipe: Recipe, lang: Lang): RecipeRow[] {
  const rows: RecipeRow[] = [];
  const first = <K extends keyof Recipe['steps'][number]['settings']>(key: K) => recipe.steps.find((step) => step.settings[key] !== undefined)?.settings[key];
  if (recipe.preset) {
    rows.push({ key: recipe.preset.remix ? 'recipeRemix' : 'recipePreset', value: catalogName(lang, recipe.preset.id, recipe.name.replace(MARKS, '')) });
  } else {
    rows.push({ key: 'recipePreset', value: recipe.name });
  }
  if (recipe.models.length > 0) rows.push({ key: 'recipeModel', value: recipe.models.map((model) => model.name).join(' · ') });
  const seeds = recipe.kind === 'film' ? recipe.steps.map((step) => step.settings.seeds[0]).filter((seed) => seed !== undefined) : [recipe.seed];
  rows.push({ key: 'recipeSeed', value: seeds.join(' · '), mono: true });
  const width = first('width');
  const height = first('height');
  if (width !== undefined && height !== undefined) rows.push({ key: 'recipeSize', value: `${width} × ${height}` });
  const frames = first('frames');
  const fps = first('fps');
  if (frames !== undefined) rows.push({ key: 'recipeFrames', value: fps !== undefined ? `${frames} · ${fps} fps` : String(frames) });
  const steps = first('steps');
  if (steps !== undefined) rows.push({ key: 'recipeSteps', value: String(steps) });
  for (const text of new Set(recipe.steps.flatMap((step) => step.settings.texts))) rows.push({ key: 'recipeText', value: text });
  if (recipe.steps.some((step) => step.name === 'upscale')) {
    const smooth = recipe.weights.some((weight) => weight.id.startsWith('rife'));
    rows.push({ key: 'recipePasses', value: smooth ? 'SeedVR2 1080p · RIFE ×2' : 'SeedVR2 1080p' });
  }
  // What the user gave, not what an earlier step or FFmpeg made on the way.
  const seen = new Set<string>();
  for (const slot of recipe.steps.flatMap((step) => step.inputs)) {
    if (/^(step|frame):/.test(slot.from) || slot.from === 'derived' || seen.has(slot.from)) continue;
    seen.add(slot.from);
    const sha = shortSha(slot.sha256);
    rows.push(sha ? { key: 'recipeInput', value: sha, mono: true } : { key: 'recipeInput', valueKey: 'recipeNotRecorded' });
  }
  for (const step of recipe.steps) rows.push({ key: 'recipeWorkflow', value: `${step.name} · ${shortSha(step.workflowSha256)}`, mono: true });
  const { montagio, comfyui, proxy } = recipe.stack;
  const commit = montagio.commit ? ` (${montagio.commit.slice(0, 7)})` : '';
  rows.push({ key: 'recipeStack', value: `Montagio ${montagio.version}${commit} · ComfyUI ${comfyui.tag} · comfy-api-proxy ${proxy}` });
  return rows;
}

/** Each weight file with its licence and sha256, leading to its model's row on the Open Stack page. */
export function weightRows(recipe: Recipe): { id: string; file: string; license: string; sha256?: string; href: string }[] {
  return recipe.weights.map((weight) => ({
    id: weight.id,
    file: weight.file,
    license: weight.license,
    ...(weight.sha256 ? { sha256: shortSha(weight.sha256)! } : {}),
    href: weight.modelId ? stackHref(weight.modelId) : '/open-stack',
  }));
}
