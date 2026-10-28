import { buildRecipe, compactRecipe, parseRecipe } from '../src';
import { cameraDraft, CONTEXT } from './fixtures';

describe('compactRecipe', () => {
  it('is printable ASCII on one line, without the workflows', () => {
    const base = cameraDraft();
    const recipe = buildRecipe(
      cameraDraft({ name: 'Création « été »', request: { ...base.request!, body: { ...base.request!.body, userPrompt: 'Café 🌅' } } }),
      CONTEXT,
    );
    const text = compactRecipe(recipe);
    expect(text).toMatch(/^[\x20-\x7e]*$/);
    expect(text).not.toContain('class_type');
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({
      schema: 'montagio/recipe@1',
      compact: true,
      name: 'Création « été »',
      seed: 42,
      stack: { montagio: { version: '0.1.0', commit: '4ac55b6f0000000000000000000000000000beef' } },
    });
    expect(parsed.request.body.userPrompt).toBe('Café 🌅');
    expect(parsed.steps[0]).toEqual({
      name: 'camera',
      workflowSha256: recipe.steps[0]!.workflowSha256,
      inputs: [{ from: 'imageRef', sha256: recipe.steps[0]!.inputs[0]!.sha256 }],
    });
    expect(parsed.weights[0]).toEqual({ id: 'wan22-fun-camera-high', sha256: recipe.weights[0]!.sha256 });
    expect(parseRecipe(parsed).ok).toBe(true);
  });

  it('drops the text of a 16 KiB remix to stay under the cap, and says so', () => {
    const presetYaml = `schema: montagio/preset@0.1\n# ${'x'.repeat(16 * 1024)}\n`;
    const base = cameraDraft();
    const recipe = buildRecipe(
      cameraDraft({
        presetYaml,
        preset: { id: 'slow-push', remix: true, sha256: 'b'.repeat(64) },
        request: { ...base.request!, body: { ...base.request!.body, presetYaml } },
      }),
      CONTEXT,
    );
    const text = compactRecipe(recipe);
    expect(text.length).toBeLessThanOrEqual(8192);
    const parsed = JSON.parse(text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.request.body.presetYaml).toBeUndefined();
    expect(parsed.preset.sha256).toBe('b'.repeat(64));
  });

  it('never goes over the cap it is given: it leaves out the request, then the weights, or refuses', () => {
    const recipe = buildRecipe(cameraDraft(), CONTEXT);
    const text = compactRecipe(recipe, 700);
    expect(text.length).toBeLessThanOrEqual(700);
    expect(JSON.parse(text)).toMatchObject({ truncated: true, steps: [{ name: 'camera', workflowSha256: recipe.steps[0]!.workflowSha256 }] });
    expect(() => compactRecipe(recipe, 100)).toThrow(/does not fit/);
  });
});
