// No Node module here: the Studio compares two recipes in the browser.
import type { CompactRecipe, Recipe } from './types';

/** Two recipes ran the same workflows: same steps, same hashes, in the same order. */
export function sameWorkflows(a: Pick<Recipe | CompactRecipe, 'steps'>, b: Pick<Recipe | CompactRecipe, 'steps'>): boolean {
  return a.steps.length === b.steps.length && a.steps.every((step, index) => step.workflowSha256 === b.steps[index]!.workflowSha256);
}
