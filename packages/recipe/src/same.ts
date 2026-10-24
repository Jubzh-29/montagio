// No Node module here: the Studio compares two recipes in the browser.
import type { CompactRecipe, Recipe } from './types';

/** Two recipes ran the same workflows: same steps, same hashes, in the same order. */
export function sameWorkflows(a: Pick<Recipe | CompactRecipe, 'steps'>, b: Pick<Recipe | CompactRecipe, 'steps'>): boolean {
  return a.steps.length === b.steps.length && a.steps.every((step, index) => step.workflowSha256 === b.steps[index]!.workflowSha256);
}

/** The sha256 of the files a recipe was given (not what a step or FFmpeg made on the way), sorted; null when one is unknown. */
function givenInputs(recipe: Pick<Recipe | CompactRecipe, 'steps'>): string[] | null {
  const given = recipe.steps.flatMap((step) => step.inputs).filter((slot) => !/^(step|frame):/.test(slot.from) && slot.from !== 'derived');
  if (given.some((slot) => slot.sha256 === null)) return null;
  return given.map((slot) => `${slot.from}=${slot.sha256}`).sort();
}

/**
 * How a render compares with the recipe it reproduces: the same workflows, and the same input files
 * (an input file is a marker in a workflow, so another photo leaves the workflow the same). `inputs`
 * is null when one sha256 is not known.
 */
export function compareRecipes(original: Pick<Recipe | CompactRecipe, 'steps'>, made: Pick<Recipe | CompactRecipe, 'steps'>): { workflow: boolean; inputs: boolean | null } {
  const [a, b] = [givenInputs(original), givenInputs(made)];
  return { workflow: sameWorkflows(original, made), inputs: a && b ? a.join() === b.join() : null };
}
