import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildRecipe, compactRecipe, findLocalPath, readStack, sha256Hex, type ApiWorkflow, type InputSlot, type Recipe, type RecipeDraft, type RecipeRequest, type RecipeStack } from '@montagio/recipe';
import { ASS_GENERATOR } from '@montagio/captions';
import { RECIPE_TAG, type VideoTags } from '@montagio/sequence';
import type { Reprise } from '@/lib/api-types';
import type { RecipeSource } from '@/lib/recipe-url';
import { captionFontsDigest } from './caption-fonts';
import { getEnv } from './env';
import { mediaFileFor } from './generations';
import { historyItem } from './history';
import { fileSha256 } from './inputs';
import { jobs, readJobSteps, type JobRecord } from './jobs';
import { readSequence } from './sequences';
import { getServices } from './services';
import { readInputs, readPresetText, readRecord, readWorkflow, writeAtomic } from './store';

// The pinned stack is read once per checkout, shared by every route bundle of this process.
const holder = globalThis as typeof globalThis & { __montagioStacks?: Map<string, Promise<RecipeStack>> };
const stacks = (holder.__montagioStacks ??= new Map());

function stackOf(root: string): Promise<RecipeStack> {
  let stack = stacks.get(root);
  if (!stack) {
    stack = readStack(root);
    stacks.set(root, stack);
    stack.catch(() => stacks.delete(root));
  }
  return stack;
}

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const FOLDERS: Record<RecipeSource, string> = { generation: 'generations', job: 'jobs', sequence: 'sequences' };
/** The recipe written when a result was delivered, beside its record: what made it, not what the app is now. */
const snapshotFile = (source: RecipeSource, id: string) => join(getEnv().data, FOLDERS[source], id, 'recipe.json');

async function readSnapshot(source: RecipeSource, id: string): Promise<Recipe | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(snapshotFile(source, id), 'utf8')) as Recipe;
  } catch {
    return null;
  }
}

/** A recipe as a draft again: what a film or an HD clip made from it starts with. */
function draftFromRecipe(recipe: Recipe): RecipeDraft {
  // What buildRecipe works out again: the hashes, the weights, the models, the stack of the new render.
  const rest: Partial<Recipe> = { ...recipe };
  for (const key of ['schema', 'steps', 'models', 'weights', 'stack', 'output'] as const) delete rest[key];
  return {
    ...(rest as Omit<RecipeDraft, 'steps'>),
    steps: recipe.steps.map(({ name, workflow, inputs }) => ({ name, workflow, inputs })),
    modelIds: recipe.models.map((model) => model.id),
  };
}

/** What the recipe never carries of the Studio's choices: this machine's photo and clip, its own remix id. */
const PRIVATE_REPRISE: (keyof Reprise)[] = ['imageRef', 'personal', 'photoMissing', 'videoRef', 'remixGenerationId'];

function shareable(reprise: Reprise): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...reprise };
  for (const key of PRIVATE_REPRISE) delete copy[key];
  return copy;
}

/** The text of a preset of the library, or null when it has no file here. */
async function libraryText(file: string | undefined): Promise<string | null> {
  return file ? readFile(join(getEnv().root, file), 'utf8').catch(() => null) : null;
}

const presetOf = (id: string, text: string | null, remix = false): Pick<RecipeDraft, 'preset' | 'presetYaml'> =>
  text === null ? {} : { preset: { id, remix, sha256: sha256Hex(text) }, presetYaml: text };

/**
 * The input slots of a step saved before they were noted: each value that names a file of the
 * request (or its file name), an earlier output, or anything of the machine. Their sha256 is unknown.
 */
function guessedSlots(workflow: ApiWorkflow, names: ReadonlyMap<string, string>): InputSlot[] {
  const slots: InputSlot[] = [];
  for (const [node, { inputs }] of Object.entries(workflow)) {
    for (const [field, value] of Object.entries(inputs)) {
      if (typeof value !== 'string') continue;
      const from = names.get(value) ?? (findLocalPath(value) ? 'derived' : undefined);
      if (from) slots.push({ node, field, from, sha256: null });
    }
  }
  return slots;
}

/** Every value (and file name) that names a file of a job's inputs or steps, with where it comes from. */
function fileNames(record: JobRecord): Map<string, string> {
  const names = new Map<string, string>();
  const add = (value: string, from: string) => {
    names.set(value, from);
    names.set(basename(value), from);
  };
  for (const [key, value] of Object.entries(record.inputs)) {
    if (typeof value === 'string' && /Ref$|Url$/.test(key)) add(value, key === 'clipUrl' ? 'clipUrl' : key);
    if (key === 'compose' && value && typeof value === 'object') {
      for (const [role, ref] of Object.entries(value)) if (typeof ref === 'string') add(ref, `compose.${role}`);
    }
  }
  record.steps.forEach((step, index) => step.outputPath && add(step.outputPath, `step:${index}`));
  return names;
}

const sha256From = (slots: readonly InputSlot[], field: string) => slots.find((slot) => slot.from === field)?.sha256 ?? null;

async function generationDraft(id: string): Promise<RecipeDraft | null> {
  const [record, workflow] = await Promise.all([readRecord(id), readWorkflow(id)]);
  if (!record || !workflow) return null;
  const lib = await getServices().library;
  const binding = lib.models.get(record.modelId)?.bindings.image;
  const inputs =
    (await readInputs(id)) ??
    (binding ? [{ node: binding.node, field: binding.field, from: 'imageRef', sha256: null }] : guessedSlots(workflow, new Map([[record.imageRef, 'imageRef']])));
  const text = record.remix ? await readPresetText(id) : await libraryText(lib.presetFiles.get(record.presetId));
  const item = await historyItem('generation', id);
  return {
    kind: 'clip',
    task: 'camera',
    name: item?.name ?? record.presetId,
    createdAt: record.createdAt,
    backend: record.backendKind,
    seed: record.seed,
    ...presetOf(record.presetId, text, record.remix === true),
    ...(item ? { reprise: shareable(item.reprise) } : {}),
    request: {
      route: '/api/generations',
      body: {
        ...(record.remix && text !== null ? { presetYaml: text } : { presetId: record.presetId }),
        modelId: record.modelId,
        ...(record.userPrompt ? { userPrompt: record.userPrompt } : {}),
        ...(record.negative !== undefined ? { negative: record.negative } : {}),
        seed: record.seed,
      },
      files: [{ field: 'imageRef', sha256: sha256From(inputs, 'imageRef') }],
    },
    steps: [{ name: 'camera', workflow, inputs }],
    modelIds: [record.modelId],
    post: ['tag'],
  };
}

async function sequenceDraft(id: string): Promise<RecipeDraft | null> {
  const film = await readSequence(id);
  if (!film) return null;
  const shots = (await Promise.all(film.shots.map((shot) => (shot.generationId ? generationDraft(shot.generationId) : null)))).filter(
    (draft): draft is RecipeDraft => draft !== null,
  );
  if (shots.length === 0) return null;
  // Each shot after the first starts on the last frame of the one before (FFmpeg takes it).
  const steps = shots.map((shot, index) => {
    const step = shot.steps[0]!;
    const inputs = index === 0 ? step.inputs : step.inputs.map((slot) => (slot.from === 'imageRef' ? { ...slot, from: `frame:${index - 1}` } : slot));
    return { ...step, name: `shot ${index + 1}`, inputs };
  });
  const item = await historyItem('sequence', id);
  return {
    kind: 'film',
    task: 'film',
    name: item?.name ?? 'Film',
    createdAt: film.createdAt,
    backend: shots[0]!.backend,
    seed: shots[0]!.seed,
    ...(item ? { reprise: shareable(item.reprise) } : {}),
    request: {
      route: '/api/sequences',
      body: {
        shots: film.shots.map((shot, index) => ({
          presetId: shot.presetId,
          ...(shot.modelId ? { modelId: shot.modelId } : {}),
          ...(shot.userPrompt ? { userPrompt: shot.userPrompt } : {}),
          ...((shot.seed ?? shots[index]?.seed) !== undefined ? { seed: shot.seed ?? shots[index]!.seed } : {}),
        })),
      },
      files: [{ field: 'imageRef', sha256: sha256From(steps[0]!.inputs, 'imageRef') }],
    },
    steps,
    modelIds: [...new Set(shots.flatMap((shot) => shot.modelIds ?? []))],
    post: ['tag', 'last-frame', 'concat', 'vertical'],
  };
}

/** The request that makes a job again, the same seed included; none for a task the API cannot start alone. */
function jobRequest(record: JobRecord, slots: readonly InputSlot[]): RecipeRequest | undefined {
  const inputs = record.inputs;
  const text = (key: string) => (typeof inputs[key] === 'string' && inputs[key] !== '' ? { [key]: inputs[key] } : {});
  const files = (...fields: string[]) => fields.filter((field) => typeof inputs[field] === 'string').map((field) => ({ field, sha256: sha256From(slots, field) }));
  const seed = record.seed;
  // A start photo composed from several, as an effect's, a motion's character or a restyle's look.
  const composed = inputs.compose && typeof inputs.compose === 'object' ? Object.keys(inputs.compose) : [];
  const composeFiles = () => composed.map((role) => ({ field: `compose.${role}`, sha256: sha256From(slots, `compose.${role}`) }));
  switch (record.task) {
    case 't2i':
      return { route: '/api/images', body: { ...text('prompt'), ...(inputs.style ? { style: inputs.style } : {}), ...(record.aspect ? { aspect: record.aspect } : {}), seed }, files: [] };
    case 'edit':
      return { route: '/api/edits', body: { ...text('instruction'), ...text('look'), ...text('scene'), seed }, files: files('imageRef', 'maskRef') };
    case 'effect':
      return {
        route: '/api/effects',
        body: { ...text('effectId'), ...text('subject'), seed },
        files: composed.length > 0 ? composeFiles() : files('imageRef'),
      };
    case 'hook':
      return { route: '/api/hooks', body: { ...text('hookId'), seed }, files: files('imageRef', 'image2Ref') };
    case 'avatar':
      return { route: '/api/avatars', body: { ...text('text'), ...text('language'), seed }, files: files('imageRef', 'voiceRef') };
    case 'motion':
      return {
        route: '/api/motion',
        body: { ...text('character'), ...text('motion'), seed },
        files: [...(composed.length > 0 ? composeFiles() : files('imageRef')), ...files('videoRef')],
      };
    case 'restyle':
      // The rights are the user's word, never the recipe's: the request goes without them.
      return { route: '/api/restyle', body: { ...text('prompt'), seed }, files: [...(composed.length > 0 ? composeFiles() : files('imageRef')), ...files('videoRef')] };
    case 'swap':
      return {
        route: '/api/swap',
        body: { ...text('prompt'), points: inputs.points, ...(inputs.exclude ? { exclude: inputs.exclude } : {}), seed },
        files: files('videoRef', 'imageRef'),
      };
    case 'ad':
      return { route: '/api/ads', body: { ...text('style'), ...text('effectId'), ...text('tagline'), seed }, files: files('productRef', 'characterRef', 'overlayRef') };
    case 'image-upscale':
      return { route: '/api/images/upscale', body: { seed }, files: files('imageRef') };
    default:
      // music and HD follow their parent; a voice change needs the avatar it changes.
      return undefined;
  }
}

/** What a job asks for once its parent is made again: the HD pass of a clip, the music of a film. */
function followUp(record: JobRecord): RecipeRequest | undefined {
  if (record.task === 'upscale' && record.parent) {
    const base = record.parent.source === 'generation' ? 'generations' : 'jobs';
    return { route: `/api/${base}/:parent/upscale`, body: { smooth: record.inputs.smooth === true, seed: record.seed }, files: [] };
  }
  if (record.task === 'captions' && record.parent) {
    // The same words burned in again, in the same style: Whisper hears the clip made again, the corrected text goes on it.
    return {
      route: '/api/jobs/:parent/captions',
      body: { language: record.inputs.language, ...(record.inputs.export ? { export: record.inputs.export } : {}) },
      files: [],
    };
  }
  if (record.task === 'music') {
    return {
      route: '/api/sequences/:parent/music',
      body: { prompt: record.inputs.prompt, ...(record.inputs.bpm !== undefined ? { bpm: record.inputs.bpm } : {}), seed: record.seed },
      files: [],
    };
  }
  return undefined;
}

/** What a captions job did after ComfyUI: the transcription alone, or a 9:16 export in a style, with the writer and the fonts it drew with. */
async function captionsPost(record: JobRecord): Promise<string[]> {
  const exported = record.inputs.export as { style?: string } | undefined;
  return exported?.style ? [`captions-9x16:${exported.style}:${ASS_GENERATOR}:fonts-${await captionFontsDigest()}`] : ['transcribe'];
}

/** `inputs` replace some of the record's (a captions export: its text, style and language), for the recipe of what they make. */
async function jobDraft(id: string, inputs?: Record<string, unknown>): Promise<RecipeDraft | null> {
  const read = await readJobSteps(id);
  if (!read || read.steps.length === 0) return null;
  const record = inputs ? { ...read.record, inputs: { ...read.record.inputs, ...inputs } } : read.record;
  const lib = await getServices().library;
  const names = fileNames(record);
  let steps = read.steps.map((step) => ({ name: step.name, workflow: step.workflow, inputs: step.inputs ?? guessedSlots(step.workflow, names) }));
  const item = await historyItem('job', id);
  const effectId = typeof record.inputs.effectId === 'string' ? record.inputs.effectId : undefined;
  const hookId = typeof record.inputs.hookId === 'string' ? record.inputs.hookId : undefined;
  let preset = effectId
    ? presetOf(effectId, await libraryText(lib.effectFiles.get(effectId)))
    : hookId
      ? presetOf(hookId, await libraryText(lib.hookFiles.get(hookId)))
      : {};
  let request = jobRequest(record, steps.flatMap((step) => step.inputs));
  let post = ['tag'];
  // The backend that rendered it; a job made before it was noted: its demo mark, else the app's now.
  let backend: string = record.backendKind ?? (record.demo ? 'demo' : getServices().backend.kind);

  // An HD clip or a film's music: the steps of what it was made from come first.
  const parent = record.parent ? await draftOf(record.parent.source, record.parent.id) : null;
  if (parent) {
    const offset = parent.steps.length;
    const renumber = (from: string) => (from === 'clipUrl' ? `step:${offset - 1}` : from.replace(/^(step|frame):(\d+)$/, (_, kind: string, n: string) => `${kind}:${Number(n) + offset}`));
    steps = [...parent.steps, ...steps.map((step) => ({ ...step, inputs: step.inputs.map((slot) => ({ ...slot, from: renumber(slot.from) })) }))];
    const then = followUp(record);
    request = parent.request && then ? { ...parent.request, then: [...(parent.request.then ?? []), then] } : undefined;
    post = [...parent.post, ...(record.task === 'music' ? ['mix', 'vertical'] : record.task === 'captions' ? await captionsPost(record) : ['tag'])];
    if (!preset.preset) preset = { ...(parent.preset ? { preset: parent.preset } : {}), ...(parent.presetYaml !== undefined ? { presetYaml: parent.presetYaml } : {}) };
    backend = parent.backend;
  }
  return {
    kind: item?.kind ?? 'clip',
    task: record.task,
    name: item?.name ?? record.label.name ?? record.task,
    createdAt: record.createdAt,
    backend,
    seed: record.seed,
    ...preset,
    ...(item ? { reprise: shareable(item.reprise) } : {}),
    ...(request ? { request } : {}),
    steps,
    modelIds: [...(parent?.modelIds ?? []), record.modelId],
    post,
  };
}

/** The draft of a result: from the recipe written at its delivery, else from its record as it is now. */
async function draftOf(source: RecipeSource, id: string): Promise<RecipeDraft | null> {
  const snapshot = await readSnapshot(source, id);
  if (snapshot) return draftFromRecipe(snapshot);
  if (source === 'generation') return generationDraft(id);
  if (source === 'sequence') return sequenceDraft(id);
  return jobDraft(id);
}

/** The recipe of a draft, with the stack, the presets and the lock of this checkout. */
async function recipeOfDraft(draft: RecipeDraft): Promise<Recipe> {
  const lib = await getServices().library;
  return buildRecipe(draft, {
    lock: lib.lock.values(),
    models: [...lib.models.values(), ...lib.extensionModels.values()],
    stack: await stackOf(getEnv().root),
  });
}

/** The recipe made from the record now. */
async function liveRecipe(source: RecipeSource, id: string): Promise<Recipe | null> {
  const draft = source === 'generation' ? await generationDraft(id) : source === 'sequence' ? await sequenceDraft(id) : await jobDraft(id);
  return draft ? recipeOfDraft(draft) : null;
}

/**
 * The recipe of a captions export: the clip's recipe, Whisper's step, then the same corrected text in the
 * same style as what follows the clip made again. Null when the job is unknown.
 */
export async function captionsExportRecipe(jobId: string, exported: { text: string; style: string }): Promise<Recipe | null> {
  // The transcription keeps the language it was asked for ("auto" included): replayed, Whisper runs the same workflow.
  const draft = await jobDraft(jobId, { export: { text: exported.text, style: exported.style } });
  return draft ? recipeOfDraft(draft) : null;
}

/** A captions export is a new result of its job: its recipe replaces the one beside the record. */
export async function replaceJobRecipe(jobId: string, recipe: Recipe): Promise<void> {
  await mkdir(join(getEnv().data, FOLDERS.job, jobId), { recursive: true });
  await writeAtomic(snapshotFile('job', jobId), JSON.stringify(recipe, null, 2));
}

/**
 * The recipe of a result: the one written at its delivery, else (a result made before recipes were
 * written, or still rendering) the one its record gives now. Null when it is unknown or nothing was submitted.
 */
export async function recipeOf(source: RecipeSource, id: string): Promise<Recipe | null> {
  return (await readSnapshot(source, id)) ?? liveRecipe(source, id);
}

/**
 * Write a result's recipe beside its record, when it is delivered: later versions of Montagio, presets or
 * lock do not change what made it. The first one written stays. Never fails the delivery: the log says why.
 */
export async function snapshotRecipe(source: RecipeSource, id: string): Promise<Recipe | null> {
  try {
    const written = await readSnapshot(source, id);
    if (written) return written;
    const recipe = await liveRecipe(source, id);
    if (recipe) {
      await mkdir(join(getEnv().data, FOLDERS[source], id), { recursive: true });
      await writeAtomic(snapshotFile(source, id), JSON.stringify(recipe, null, 2));
    }
    return recipe;
  } catch (error) {
    console.error(`[montagio] ${source} ${id}: the recipe could not be written`, error);
    return null;
  }
}

/** The tag a delivered file carries its compact recipe in, beside the AI-generated mention; the recipe is written beside the record too. */
export async function recipeTags(source: RecipeSource, id: string, kind: keyof typeof RECIPE_TAG): Promise<VideoTags> {
  const recipe = await snapshotRecipe(source, id);
  if (!recipe) return {};
  try {
    return { [RECIPE_TAG[kind]]: compactRecipe(recipe) };
  } catch (error) {
    console.error(`[montagio] ${source} ${id}: the recipe could not be written in the file`, error);
    return {};
  }
}

/** sha256 of the file a result delivered, or null before it is delivered. */
export async function deliveredSha256(source: RecipeSource, id: string): Promise<string | null> {
  const url =
    source === 'generation' ? (await readRecord(id))?.outputUrl : source === 'job' ? (await jobs.read(id))?.outputUrl : (await readSequence(id))?.outputUrl;
  const file = mediaFileFor(url);
  return file ? fileSha256(file) : null;
}
