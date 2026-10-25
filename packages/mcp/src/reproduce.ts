import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parseRecipe, sameWorkflows, type CompactRecipe, type Recipe } from '@montagio/recipe';
import { readImageTags, readSentTags, RECIPE_TAG } from '@montagio/sequence';
import type { RecipeRequest } from '@montagio/recipe';
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
  /** The speaker of the voice sample agreed (an avatar in someone's own voice). */
  voiceConsent?: boolean;
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
      if (VIDEO.has(ext)) raw = JSON.parse((await readSentTags(path))[RECIPE_TAG.video] ?? 'null');
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

// A recipe is a file from anywhere: it may name only the app's creation routes, its own input files, and never the user's word.
/** The creation routes a recipe's request may name, and what may follow on what it made. */
const ROUTES = new Set(['/api/generations', '/api/sequences', '/api/images', '/api/images/upscale', '/api/edits', '/api/effects', '/api/hooks', '/api/avatars', '/api/motion', '/api/ads']);
const FOLLOW_UPS = new Set(['/api/generations/:parent/upscale', '/api/jobs/:parent/upscale', '/api/sequences/:parent/music', '/api/jobs/:parent/captions']);
/** Only the user says that the person agreed, or that they hold the rights: never a recipe. */
const USER_ONLY = new Set(['consent', 'rights', 'voiceConsent']);
/** A file field: a name, or a composed photo's role ("compose.place"). */
const FILE_FIELD = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)?$/;
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function refuse(why: string): never {
  throw new ToolFailure('invalid-recipe', `This recipe cannot be replayed: ${why}.`);
}

function checkRequest(request: RecipeRequest): void {
  if (!ROUTES.has(request.route)) refuse(`${request.route} is not a creation route of Montagio`);
  for (const file of request.files) {
    if (!FILE_FIELD.test(file.field) || file.field.split('.').some((part) => PROTOTYPE_KEYS.has(part))) refuse(`"${file.field}" is not a file field`);
  }
  // One follow-up at most (the HD pass, a film's music): a recipe never chains renders on the user's GPU.
  if ((request.then?.length ?? 0) > 1) refuse('it asks for more than one render after the first');
  for (const next of request.then ?? []) {
    if (!FOLLOW_UPS.has(next.route) || next.files.length > 0 || (next.then?.length ?? 0) > 0) refuse(`${next.route} cannot follow it`);
  }
}

/**
 * The body without what only the user gives (consent, rights) and without any file of the app (a ref,
 * a composition, another render): the request's files are set from the inputs given, and nothing else.
 */
function cleanBody(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(body)).filter(
      ([key]) => !USER_ONLY.has(key) && !PROTOTYPE_KEYS.has(key) && !/Ref$/.test(key) && key !== 'compose' && key !== 'sourceJobId',
    ),
  );
}

/** Set `body.a.b` for the field "a.b" (a composed photo's references); fields are checked by checkRequest. */
function setField(body: Record<string, unknown>, field: string, value: string): void {
  const [head, tail] = field.split('.') as [string, string | undefined];
  if (tail === undefined) {
    body[head] = value;
    return;
  }
  const inner = Object.hasOwn(body, head) && body[head] && typeof body[head] === 'object' ? (body[head] as Record<string, unknown>) : {};
  inner[tail] = value;
  body[head] = inner;
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
  checkRequest(request);
  const missing = request.files.filter((file) => !args.inputs[file.field]).map((file) => file.field);
  if (missing.length > 0) {
    throw new ToolFailure('inputs-required', `Give ${missing.join(', ')}: the recipe renders on the file the user has, never on one it carries.`, {
      fields: missing,
      sha256: Object.fromEntries(request.files.map((file) => [file.field, file.sha256])),
    });
  }

  const body = cleanBody(request.body);
  const sameInputs: Record<string, boolean | null> = {};
  for (const file of request.files) {
    const given = args.inputs[file.field]!;
    let ref = given;
    let sha: string | null = null;
    // The app keeps a reference clip's first 5 s and a voice sample as a mono FLAC: their sha256 is not the file's own.
    const prepared = file.field === 'videoRef' || file.field === 'voiceRef';
    if (!isRef(given)) {
      sha = prepared ? null : await fileSha256(resolve(given));
      if (file.field === 'videoRef') ref = (await client.uploadVideo(given)).videoRef;
      else if (file.field === 'voiceRef') ref = (await client.uploadVoice(given)).voiceRef;
      else ref = (await client.uploadPhoto(given)).imageRef;
    }
    setField(body, file.field, ref);
    sameInputs[file.field] = sha && file.sha256 ? sha === file.sha256 : null;
  }
  if (args.consent) body.consent = true;
  if (args.rights) body.rights = true;
  if (args.voiceConsent) body.voiceConsent = true;

  let done = await settled(client, await client.startRequest(request.route, body), options);
  for (const next of request.then ?? []) {
    done = await settled(client, await client.startRequest(next.route.replace(':parent', encodeURIComponent(done.id)), cleanBody(next.body)), options);
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
