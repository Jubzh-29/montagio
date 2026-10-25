import type { Recipe } from '@montagio/recipe';
import { recipeRows, shortSha, weightRows } from '@/lib/recipe-view';

const PHOTO = '9bf2c4365d1a364dfde4a6b7dfd1fcf9d9d16e473959aa42ebd9cc26fec4b532';
const WORKFLOW = 'ab'.repeat(32);

function cameraRecipe(): Recipe {
  return {
    schema: 'montagio/recipe@1',
    kind: 'clip',
    task: 'camera',
    name: 'Crash Push',
    createdAt: '2026-10-24T18:00:00.000Z',
    backend: 'demo',
    seed: 42,
    preset: { id: 'crash-push', remix: false, sha256: 'c'.repeat(64) },
    steps: [
      {
        name: 'camera',
        workflow: {},
        workflowSha256: WORKFLOW,
        inputs: [{ node: '97', field: 'image', from: 'imageRef', sha256: PHOTO }],
        settings: { width: 832, height: 480, frames: 81, fps: 16, steps: 4, cfg: 1, seeds: [42, 0], texts: ['A harbour at dawn'] },
      },
    ],
    post: ['tag'],
    models: [{ id: 'wan22-i2v-a14b-fun-camera', name: 'Wan 2.2 Fun Camera', license: 'Apache-2.0' }],
    weights: [
      {
        id: 'wan21-vae',
        file: 'wan_2.1_vae.safetensors',
        sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
        license: 'Apache-2.0',
        source: 'https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P',
        url: 'https://huggingface.co/x',
        modelId: 'wan22-i2v-a14b-fun-camera',
      },
    ],
    stack: { montagio: { version: '0.1.0', commit: '4ac55b6f0000000000000000000000000000beef' }, comfyui: { tag: 'v0.41.0', commit: '98cc0bf8' }, proxy: '0.1.6', nodes: [] },
  };
}

test('shortSha keeps the start and the end of a sha256', () => {
  expect(shortSha(PHOTO)).toBe('9bf2c436…26fec4b532');
  expect(shortSha(null)).toBeNull();
});

test('a camera clip reads as its preset, model, seed, size, frames, steps, text, input, workflow and versions', () => {
  const rows = recipeRows(cameraRecipe(), 'en');
  expect(rows.map((row) => row.key)).toEqual([
    'recipePreset',
    'recipeModel',
    'recipeSeed',
    'recipeSize',
    'recipeFrames',
    'recipeSteps',
    'recipeText',
    'recipeInput',
    'recipeWorkflow',
    'recipeStack',
  ]);
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  expect(value('recipePreset')).toBe('Crash Push');
  expect(value('recipeModel')).toBe('Wan 2.2 Fun Camera');
  expect(value('recipeSeed')).toBe('42');
  expect(value('recipeSize')).toBe('832 × 480');
  expect(value('recipeFrames')).toBe('81 · 16 fps');
  expect(value('recipeSteps')).toBe('4');
  expect(value('recipeText')).toBe('A harbour at dawn');
  expect(value('recipeInput')).toBe('9bf2c436…26fec4b532');
  expect(value('recipeWorkflow')).toBe('camera · abababab…ababababab');
  expect(value('recipeStack')).toBe('Montagio 0.1.0 (4ac55b6) · ComfyUI v0.41.0 · comfy-api-proxy 0.1.6');
});

test('the preset is named in French when the interface is', () => {
  expect(recipeRows(cameraRecipe(), 'fr')[0]!.value).toBe('Avancée éclair');
});

test('a remix says so', () => {
  const recipe = cameraRecipe();
  recipe.preset!.remix = true;
  expect(recipeRows(recipe, 'en')[0]!.key).toBe('recipeRemix');
});

test('an input noted before sha256s were kept reads "not recorded"', () => {
  const recipe = cameraRecipe();
  recipe.steps[0]!.inputs[0]!.sha256 = null;
  const row = recipeRows(recipe, 'en').find((entry) => entry.key === 'recipeInput')!;
  expect(row.valueKey).toBe('recipeNotRecorded');
});

test('an HD clip lists its passes: SeedVR2 at 1080p, and RIFE when it is smooth', () => {
  const recipe = cameraRecipe();
  recipe.steps.push({ name: 'upscale', workflow: {}, workflowSha256: WORKFLOW, inputs: [{ node: '1', field: 'video', from: 'step:0', sha256: PHOTO }], settings: { seeds: [5], texts: [] } });
  expect(recipeRows(recipe, 'en').find((row) => row.key === 'recipePasses')?.value).toBe('SeedVR2 1080p');
  recipe.weights.push({ id: 'rife-v4-26', file: 'rife_v4.26.safetensors', license: 'MIT', source: 'https://huggingface.co/x', url: 'https://huggingface.co/x' });
  expect(recipeRows(recipe, 'en').find((row) => row.key === 'recipePasses')?.value).toBe('SeedVR2 1080p · RIFE ×2');
  // An input that an earlier step made is not an input of the recipe.
  expect(recipeRows(recipe, 'en').filter((row) => row.key === 'recipeInput')).toHaveLength(1);
});

test('a film gives the seed of each shot', () => {
  const recipe = cameraRecipe();
  recipe.kind = 'film';
  recipe.steps = [
    { ...recipe.steps[0]!, name: 'shot 1', settings: { ...recipe.steps[0]!.settings, seeds: [7, 0] } },
    { ...recipe.steps[0]!, name: 'shot 2', settings: { ...recipe.steps[0]!.settings, seeds: [8, 0] } },
  ];
  expect(recipeRows(recipe, 'en').find((row) => row.key === 'recipeSeed')?.value).toBe('7 · 8');
});

test('each weight leads to the row of its model on the Open Stack page', () => {
  expect(weightRows(cameraRecipe())).toEqual([
    {
      id: 'wan21-vae',
      file: 'wan_2.1_vae.safetensors',
      license: 'Apache-2.0',
      sha256: '2fc39d31…e15148976b',
      href: '/open-stack#model-wan22-i2v-a14b-fun-camera',
    },
  ]);
});
