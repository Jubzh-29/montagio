import { findLocalPath, normalizeWorkflow, summarizeWorkflow, workflowSha256 } from './hash';
import { RECIPE_SCHEMA, type ApiWorkflow, type LockLike, type ModelLike, type Recipe, type RecipeContext, type RecipeDraft, type RecipeModel, type RecipeWeight } from './types';

/** Every string input of the workflows: the file and pack names they load among them. */
function stringInputs(workflows: readonly ApiWorkflow[]): Set<string> {
  const values = new Set<string>();
  for (const workflow of workflows) {
    for (const node of Object.values(workflow)) {
      for (const value of Object.values(node.inputs)) if (typeof value === 'string') values.add(value);
    }
  }
  return values;
}

/** A pack a node reads by its folder name ("tts/chatterbox/resembleai-mtl-v3" → "resembleai-mtl-v3"); a plain models/ folder is not one. */
const packName = (entry: LockLike) => (entry.folder && entry.folder.includes('/') ? entry.folder.split('/').at(-1) : undefined);

/** The lock entries the workflows load: named by their file, or by the pack folder they sit in. */
export function loadedWeights(workflows: readonly ApiWorkflow[], lock: readonly LockLike[]): LockLike[] {
  const values = stringInputs(workflows);
  return lock.filter((entry) => values.has(entry.file) || (packName(entry) !== undefined && values.has(packName(entry)!)));
}

/**
 * The weights of the recipe, each with the model that brings it: the models that ran (`ran`) first,
 * then the model of the registry that declares most of these weights, so a text encoder shared by
 * several models goes to the one that ran. Only models that bring at least one weight are named.
 */
function resolveWeights(
  workflows: readonly ApiWorkflow[],
  lock: readonly LockLike[],
  models: readonly ModelLike[],
  ran: readonly string[] = [],
): { weights: RecipeWeight[]; models: RecipeModel[] } {
  const loaded = loadedWeights(workflows, lock);
  const ids = new Set(loaded.map((entry) => entry.id));
  // The models that ran come first, then the others by how many of these weights they declare.
  const rank = (model: ModelLike) => (ran.includes(model.id) ? ran.indexOf(model.id) - ran.length : 0);
  const ranked = models
    .map((model) => ({ model, count: model.weights.filter((id) => ids.has(id)).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => rank(a.model) - rank(b.model) || b.count - a.count)
    .map(({ model }) => model);
  const weights = loaded.map((entry): RecipeWeight => {
    const modelId = ranked.find((model) => model.weights.includes(entry.id))?.id;
    return {
      id: entry.id,
      file: entry.file,
      ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
      ...(entry.git_sha1 ? { git_sha1: entry.git_sha1 } : {}),
      ...(entry.size !== undefined ? { size: entry.size } : {}),
      license: entry.license,
      source: entry.source,
      url: entry.url,
      ...(modelId ? { modelId } : {}),
    };
  });
  const used = new Set(weights.map((weight) => weight.modelId));
  return { weights, models: ranked.filter((model) => used.has(model.id)).map(({ id, name, license }) => ({ id, name, license })) };
}

/** The recipe of a draft: each workflow normalized and hashed, its settings read, its weights looked up. */
export function buildRecipe(draft: RecipeDraft, ctx: RecipeContext): Recipe {
  const lock = [...ctx.lock];
  const steps = draft.steps.map(({ name, workflow, inputs }) => {
    const normalized = normalizeWorkflow(workflow, inputs);
    return { name, workflow: normalized, workflowSha256: workflowSha256(normalized), inputs, settings: summarizeWorkflow(normalized) };
  });
  const { weights, models } = resolveWeights(
    steps.map((step) => step.workflow),
    lock,
    [...ctx.models],
    draft.modelIds,
  );
  const recipe: Recipe = {
    schema: RECIPE_SCHEMA,
    kind: draft.kind,
    task: draft.task,
    name: draft.name,
    createdAt: draft.createdAt,
    backend: draft.backend,
    seed: draft.seed,
    ...(draft.preset ? { preset: draft.preset } : {}),
    ...(draft.presetYaml !== undefined ? { presetYaml: draft.presetYaml } : {}),
    ...(draft.reprise ? { reprise: draft.reprise } : {}),
    ...(draft.request ? { request: draft.request } : {}),
    steps,
    post: draft.post,
    models,
    weights,
    stack: ctx.stack,
  };
  const leak = findLocalPath(recipe);
  if (leak) throw new Error(`the recipe would hold a local path: ${leak}`);
  return recipe;
}
