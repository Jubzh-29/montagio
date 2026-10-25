import { loadedWeights } from './build';
import { workflowSha256 } from './hash';
import type { LockLike, Recipe } from './types';

/** The licences of the open stack: a weight under any other fails the check. */
export const OPEN_LICENSES: ReadonlySet<string> = new Set(['Apache-2.0', 'MIT']);
/** Input values that name a weight file (as check-open-stack reads them). */
const WEIGHT_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;

/**
 * What does not hold in a recipe, one line each: a workflow edited after its hash, a weight that is not
 * the lock's or not under an open licence, a file a workflow loads that the recipe or the lock leaves out.
 */
export function checkRecipe(recipe: Recipe, lockEntries: Iterable<LockLike>): string[] {
  const lock = [...lockEntries];
  const byId = new Map(lock.map((entry) => [entry.id, entry]));
  const problems: string[] = [];
  recipe.steps.forEach((step, index) => {
    if (workflowSha256(step.workflow) !== step.workflowSha256) problems.push(`step ${index} (${step.name}): workflowSha256 does not match its workflow`);
  });
  for (const weight of recipe.weights) {
    const entry = byId.get(weight.id);
    if (!entry) {
      problems.push(`weight ${weight.id}: not in the lock`);
      continue;
    }
    if (entry.file !== weight.file) problems.push(`weight ${weight.id}: file differs from the lock`);
    if (entry.sha256 !== weight.sha256) problems.push(`weight ${weight.id}: sha256 differs from the lock`);
    for (const license of new Set([weight.license, entry.license])) {
      if (!OPEN_LICENSES.has(license)) problems.push(`weight ${weight.id}: license ${license} is not Apache-2.0 or MIT`);
    }
  }
  const listed = new Set(recipe.weights.map((weight) => weight.id));
  const lockFiles = new Set(lock.map((entry) => entry.file));
  recipe.steps.forEach((step, index) => {
    for (const entry of loadedWeights([step.workflow], lock)) {
      if (!listed.has(entry.id)) problems.push(`step ${index} loads ${entry.file}, which the recipe does not list`);
    }
    for (const node of Object.values(step.workflow)) {
      for (const value of Object.values(node.inputs)) {
        if (typeof value === 'string' && WEIGHT_FILE.test(value) && !lockFiles.has(value)) problems.push(`step ${index} loads ${value}, which is not in the lock`);
      }
    }
  });
  return problems;
}
