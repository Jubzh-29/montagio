import { buildRecipe, compactRecipe, parseRecipe } from '../src';
import { cameraDraft, CONTEXT } from './fixtures';

describe('parseRecipe', () => {
  it('reads back a recipe written as JSON', () => {
    const recipe = buildRecipe(cameraDraft(), CONTEXT);
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual({ ok: true, recipe });
  });

  it('reads a compact recipe', () => {
    const result = parseRecipe(JSON.parse(compactRecipe(buildRecipe(cameraDraft(), CONTEXT))));
    expect(result.ok && 'compact' in result.recipe && result.recipe.compact).toBe(true);
  });

  it('refuses another schema, a short sha256 and a seed out of range', () => {
    const recipe = JSON.parse(JSON.stringify(buildRecipe(cameraDraft(), CONTEXT)));
    expect(parseRecipe({ ...recipe, schema: 'montagio/recipe@0.1' }).ok).toBe(false);
    expect(parseRecipe({ ...recipe, seed: 2 ** 32 }).ok).toBe(false);
    expect(parseRecipe({ ...recipe, seed: -1 }).ok).toBe(false);
    const short = structuredClone(recipe);
    short.steps[0].workflowSha256 = 'abc';
    const result = parseRecipe(short);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join('\n')).toContain('steps.0.workflowSha256');
  });

  it('refuses what is not an object', () => {
    expect(parseRecipe('recipe').ok).toBe(false);
    expect(parseRecipe(null).ok).toBe(false);
  });
});
