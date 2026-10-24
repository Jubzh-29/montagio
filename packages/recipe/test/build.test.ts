import { buildRecipe, RECIPE_SCHEMA } from '../src';
import { cameraDraft, cameraWorkflow, CONTEXT, PHOTO_SHA, PHOTO_SLOT, STACK } from './fixtures';

describe('buildRecipe', () => {
  it('lists the exact weight files the workflow loads, with their lock sha256, licence and source', () => {
    const recipe = buildRecipe(cameraDraft(), CONTEXT);
    expect(recipe.schema).toBe(RECIPE_SCHEMA);
    expect(recipe.weights.map((weight) => weight.id)).toEqual(['wan22-fun-camera-high', 'wan22-fun-camera-low', 'umt5-xxl-fp8', 'wan21-vae']);
    expect(recipe.weights[0]).toMatchObject({
      file: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors',
      sha256: '89a99cb5ab29e388f2e24fddac48eab4d88ca339d236c7a8d96aabacd0f525ae',
      license: 'Apache-2.0',
      source: 'https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera',
      modelId: 'wan22-i2v-a14b-fun-camera',
    });
  });

  it('names the models those weights belong to, not one that only shares a file', () => {
    const recipe = buildRecipe(cameraDraft(), CONTEXT);
    expect(recipe.models).toEqual([{ id: 'wan22-i2v-a14b-fun-camera', name: 'Wan 2.2 Fun Camera', license: 'Apache-2.0' }]);
    expect(recipe.weights.every((weight) => weight.modelId === 'wan22-i2v-a14b-fun-camera')).toBe(true);
  });

  it('keeps the settings of each step, the seed, the inputs by sha256 and the stack', () => {
    const recipe = buildRecipe(cameraDraft(), CONTEXT);
    expect(recipe.seed).toBe(42);
    expect(recipe.steps[0]!.settings).toMatchObject({ width: 832, height: 480, frames: 81, fps: 16, steps: 4, seeds: [42] });
    expect(recipe.steps[0]!.inputs).toEqual([{ node: '58', field: 'image', from: 'imageRef', sha256: PHOTO_SHA }]);
    expect(recipe.stack).toEqual(STACK);
    expect(recipe.post).toEqual(['tag']);
  });

  it('holds no photo name, no upload id and no local path', () => {
    const text = JSON.stringify(buildRecipe(cameraDraft(), CONTEXT));
    expect(text).not.toContain('uploads/');
    expect(text).not.toContain('1b2c3d4e');
    expect(text).toContain('"<imageRef>"');
  });

  it('takes every file of a pack the node reads by its folder name', () => {
    const workflow = {
      '2': { class_type: 'ChatterboxMTLTTS', inputs: { model_pack_name: 'resembleai-mtl-v3', model_version: 't3_mtl23ls_v3.safetensors', text: 'Hello', seed: 7 } },
    };
    const recipe = buildRecipe(cameraDraft({ task: 'avatar', steps: [{ name: 'speech', workflow, inputs: [] }] }), CONTEXT);
    expect(recipe.weights.map((weight) => weight.file)).toEqual([
      't3_mtl23ls_v3.safetensors',
      's3gen.safetensors',
      've.safetensors',
      'conds.pt',
      'grapheme_mtl_merged_expanded_v1.json',
    ]);
    expect(recipe.models.map((model) => model.id)).toEqual(['chatterbox-mtl-voice']);
  });

  it('refuses a local path that no input slot covers', () => {
    const workflow = cameraWorkflow();
    workflow['58']!.inputs.image = 'C:\\Users\\julien\\Pictures\\me.jpg';
    expect(() => buildRecipe(cameraDraft({ steps: [{ name: 'camera', workflow, inputs: [] }] }), CONTEXT)).toThrow(/local path/);
    // Declared as the photo, the same value is replaced and the recipe builds.
    expect(() => buildRecipe(cameraDraft({ steps: [{ name: 'camera', workflow, inputs: [PHOTO_SLOT] }] }), CONTEXT)).not.toThrow();
  });
});
