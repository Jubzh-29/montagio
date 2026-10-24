import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parseRecipe, sameWorkflows, type CompactRecipe, type Recipe } from '@montagio/recipe';
import { readImageTags, readTags, RECIPE_TAG } from '@montagio/sequence';
import type { RenderStatus, MontagioClient, WaitOptions } from './client';
import { ToolFailure } from './errors';

/** What a reproduction can promise, said with every result. */
export const HONESTY =
  'Same recipe, same stack: identical result on the same setup, very close elsewhere (diffusion is not always bit-exact from one graphics card to another).';

export type ReproduceArgs = {
  /** A recipe as JSON, or the path of its .json file, or of an MP4 or PNG Montagio exported (it carries the recipe). */
  recipe: unknown;
  /** The files the recipe's request names, by field ("imageRef", "videoRef"…): a local path, or a ref the app already holds. */
  inputs: Record<string, string>;
  consent?: boolean;
  rights?: boolean;
};

export type ReproduceResult = {
  render: RenderStatus;
  /** Each input given has the sha256 the recipe noted: true, false, or null when one of them is unknown. */
  sameInputs: Record<string, boolean | null>;
  /** The workflows made here have the recipe's hashes, step for step; null when the new recipe cannot be read. */
  sameWorkflow: boolean | null;
  /** The commit of Montagio that made the recipe, and the one here. */
  stack: { recipe: string | null; here: string | null };
  note: string;
};

const VIDEO = new Set(['.mp4', '.mov', '.m4v']);

/** The recipe a value names: an object, a JSON file, or the tag of an exported MP4 or PNG. */
export async function loadRecipe(source: unknown): Promise<Recipe | CompactRecipe> {
  let raw: unknown = source;
  if (typeof source === 'string') {
    const path = resolve(source);
    try {
      const ext = extname(path).toLowerCase();
      if (VIDEO.has(ext)) raw = JSON.parse((await readTags(path))[RECIPE_TAG.video] ?? 'null');
      else if (ext === '.png') raw = JSON.parse((await readImageTags(path))[RECIPE_TAG.image] ?? 'null');
      else raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new ToolFailure('invalid-recipe', `No recipe could be read from ${path}.`, { path });
    }
  }
  const parsed = parseRecipe(raw);
  if (!parsed.ok) throw new ToolFailure('invalid-recipe', undefined, { problems: parsed.problems });
  return parsed.recipe;
}

/** `inputs` with the photo put where the recipe asks for its first photo (imageRef, productRef…), unless given by field already. */
export function withPhoto(recipe: Recipe | CompactRecipe, inputs: Record<string, string>, photo: string): Record<string, string> {
  const field = recipe.request?.files.find((file) => !/^(video|voice|speech|audio)Ref$/.test(file.field) && !(file.field in inputs))?.field ?? 'imageRef';
  return { ...inputs, [field]: photo };
}

/** A value of `inputs` that is a ref the app holds already ("uploads/…", "videos/…"), not a local file. */
const isRef = (value: string) => /^(uploads|videos|voices|speech)\//.test(value);

async function fileSha256(path: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return null;
  }
}

/** Set `body.a.b` for the field "a.b" (a composed photo's references). */
function setField(body: Record<string, unknown>, field: string, value: string): void {
  const parts = field.split('.');
  let target = body;
  for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
  target[parts.at(-1)!] = value;
}

/** Wait for a render to end; anything but success is the tool's failure. */
async function settled(client: MontagioClient, start: RenderStatus, options: WaitOptions): Promise<RenderStatus> {
  const done = await client.wait(start, options);
  if (done.state !== 'succeeded') {
    throw new ToolFailure(done.error && /^[a-z0-9-]+$/.test(done.error) ? done.error : 'failed', undefined, { kind: done.kind, id: done.id, state: done.state });
  }
  return done;
}

/**
 * Render a recipe again on this Montagio (its local ComfyUI): its request with the same seed, on the
 * files given, then what follows (the HD pass, a film's music). The recipe of the new render is
 * compared with the old one, step by step, and so is each input file by its sha256.
 */
export async function reproduce(client: MontagioClient, args: ReproduceArgs, options: WaitOptions = {}): Promise<ReproduceResult> {
  const recipe = await loadRecipe(args.recipe);
  const request = recipe.request;
  if (!request) throw new ToolFailure('not-replayable');
  const missing = request.files.filter((file) => !args.inputs[file.field]).map((file) => file.field);
  if (missing.length > 0) {
    throw new ToolFailure('inputs-required', `Give ${missing.join(', ')}: the recipe renders on the file the user has, never on one it carries.`, {
      fields: missing,
      sha256: Object.fromEntries(request.files.map((file) => [file.field, file.sha256])),
    });
  }

  const body = structuredClone(request.body);
  const sameInputs: Record<string, boolean | null> = {};
  for (const file of request.files) {
    const given = args.inputs[file.field]!;
    let ref = given;
    let sha: string | null = null;
    if (!isRef(given)) {
      sha = await fileSha256(resolve(given));
      ref = file.field === 'videoRef' ? (await client.uploadVideo(given)).videoRef : (await client.uploadPhoto(given)).imageRef;
    }
    setField(body, file.field, ref);
    sameInputs[file.field] = sha && file.sha256 ? sha === file.sha256 : null;
  }
  if (args.consent) body.consent = true;
  if (args.rights) body.rights = true;

  let done = await settled(client, await client.startRequest(request.route, body), options);
  for (const next of request.then ?? []) {
    done = await settled(client, await client.startRequest(next.route.replace(':parent', encodeURIComponent(done.id)), next.body), options);
  }

  const fresh = await client
    .recipe(done.kind, done.id)
    .then((raw) => parseRecipe(raw))
    .catch(() => null);
  const here = fresh?.ok ? fresh.recipe : null;
  return {
    render: done,
    sameInputs,
    sameWorkflow: here ? sameWorkflows(recipe, here) : null,
    stack: { recipe: recipe.stack.montagio.commit, here: here?.stack.montagio.commit ?? null },
    note: HONESTY,
  };
}
