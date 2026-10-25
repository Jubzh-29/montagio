import { buildRecipe, checkRecipe, sameWorkflows, type Recipe } from '../src';
import { cameraDraft, CONTEXT, LOCK } from './fixtures';

const fresh = (): Recipe => structuredClone(buildRecipe(cameraDraft(), CONTEXT));

describe('checkRecipe', () => {
  it('finds nothing wrong in a sound recipe', () => {
    expect(checkRecipe(fresh(), LOCK)).toEqual([]);
  });

  it('sees a workflow edited after its hash was taken', () => {
    const recipe = fresh();
    recipe.steps[0]!.workflow['57']!.inputs.noise_seed = 7;
    expect(checkRecipe(recipe, LOCK)).toEqual(['step 0 (camera): workflowSha256 does not match its workflow']);
  });

  it('sees a weight whose sha256 is not the lock one', () => {
    const recipe = fresh();
    recipe.weights[3]!.sha256 = 'f'.repeat(64);
    expect(checkRecipe(recipe, LOCK)).toEqual(['weight wan21-vae: sha256 differs from the lock']);
  });

  it('sees a licence that is neither Apache-2.0 nor MIT', () => {
    const recipe = fresh();
    const lock = LOCK.map((entry) => (entry.id === 'umt5-xxl-fp8' ? { ...entry, license: 'GPL-3.0' } : entry));
    recipe.weights[2]!.license = 'GPL-3.0';
    expect(checkRecipe(recipe, lock)).toEqual(['weight umt5-xxl-fp8: license GPL-3.0 is not Apache-2.0 or MIT']);
  });

  it('sees a weight the workflow loads but the recipe does not list', () => {
    const recipe = fresh();
    recipe.weights = recipe.weights.filter((weight) => weight.id !== 'wan21-vae');
    expect(checkRecipe(recipe, LOCK)).toEqual(['step 0 loads wan_2.1_vae.safetensors, which the recipe does not list']);
  });

  it('sees a weight file the lock does not know', () => {
    const recipe = fresh();
    recipe.steps[0]!.workflow['39']!.inputs.vae_name = 'closed_vae.safetensors';
    expect(checkRecipe(recipe, LOCK)).toContain('step 0 loads closed_vae.safetensors, which is not in the lock');
  });
});

describe('sameWorkflows', () => {
  it('compares the steps by their hashes', () => {
    const a = fresh();
    const b = fresh();
    expect(sameWorkflows(a, b)).toBe(true);
    b.steps[0]!.workflowSha256 = '0'.repeat(64);
    expect(sameWorkflows(a, b)).toBe(false);
    expect(sameWorkflows(a, { steps: [] })).toBe(false);
  });
});
