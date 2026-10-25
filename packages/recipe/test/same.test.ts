import { buildRecipe, compareRecipes } from '../src';
import { cameraDraft, CONTEXT, PHOTO_SHA, PHOTO_SLOT } from './fixtures';

const recipeOn = (sha: string | null) => buildRecipe(cameraDraft({ steps: [{ name: 'camera', workflow: cameraDraft().steps[0]!.workflow, inputs: [{ ...PHOTO_SLOT, sha256: sha }] }] }), CONTEXT);

describe('compareRecipes', () => {
  it('says the same workflow on the same input files', () => {
    expect(compareRecipes(recipeOn(PHOTO_SHA), recipeOn(PHOTO_SHA))).toEqual({ workflow: true, inputs: true });
  });

  it('sees another photo even when the workflow is the same (an input file is a marker in it)', () => {
    expect(compareRecipes(recipeOn(PHOTO_SHA), recipeOn('0'.repeat(64)))).toEqual({ workflow: true, inputs: false });
  });

  it('cannot tell for an input whose sha256 was not noted', () => {
    expect(compareRecipes(recipeOn(null), recipeOn(PHOTO_SHA))).toEqual({ workflow: true, inputs: null });
  });

  it('leaves out what a step or FFmpeg made on the way: those change with the render itself', () => {
    const a = recipeOn(PHOTO_SHA);
    const b = recipeOn(PHOTO_SHA);
    for (const [recipe, sha] of [
      [a, '1'.repeat(64)],
      [b, '2'.repeat(64)],
    ] as const) {
      recipe.steps.push({ ...recipe.steps[0]!, name: 'upscale', inputs: [{ node: '1', field: 'video', from: 'step:0', sha256: sha }] });
    }
    expect(compareRecipes(a, b)).toEqual({ workflow: true, inputs: true });
  });
});
