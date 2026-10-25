import { findLocalPath, normalizeWorkflow, readStack, workflowSha256 as hashOf, type RecipeStack } from '@montagio/recipe';
import { loadLibrary, type Library } from '@montagio/presets';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, type Manifest } from '../src/manifest';
import { showcaseRecipe } from '../src/recipe';
import { hdWorkflow, showcaseWorkflow, workflowSha256 } from '../src/workflow';
import { repoRoot } from './helpers';

let library: Library;
let manifest: Manifest;
let stack: RecipeStack;
beforeAll(async () => {
  [library, manifest, stack] = await Promise.all([loadLibrary(repoRoot), loadManifest(repoRoot), readStack(repoRoot)]);
});

const entryOf = (preset: string, sample: string) => manifest.clips.find((clip) => clip.preset === preset && clip.sample === sample)!;
const sampleOf = (id: string) => manifest.samples.find((sample) => sample.id === id)!;
const yamlOf = (preset: string) => readFileSync(join(repoRoot, library.presetFiles.get(preset)!), 'utf8');
const recipeOf = (preset: string, sample: string) => showcaseRecipe(library, manifest, entryOf(preset, sample), sampleOf(sample), yamlOf(preset), stack);

test('a clip of the showcase: its photo, its 480p render, then its HD pass, each by sha256', () => {
  const entry = entryOf('crash-push', 'landscape-a');
  expect(entry.hd).toBeDefined();
  const recipe = recipeOf('crash-push', 'landscape-a');
  expect(recipe).toMatchObject({ kind: 'clip', task: 'camera', backend: 'local', seed: entry.seed, preset: { id: 'crash-push', remix: false } });
  expect(recipe.steps.map((step) => step.name)).toEqual(['camera', 'upscale']);
  const camera = library.models.get(manifest.model)!.bindings.image!;
  const slot = { node: camera.node, field: camera.field, from: 'imageRef', sha256: entry.image_sha256 };
  expect(recipe.steps[0]!.inputs).toEqual([slot]);
  const rendered = showcaseWorkflow(library, manifest, library.presets.get('crash-push')!, sampleOf('landscape-a'), entry.seed, entry);
  expect(workflowSha256(rendered)).toBe(entry.workflow_sha256);
  expect(recipe.steps[0]!.workflowSha256).toBe(hashOf(normalizeWorkflow(rendered, [slot])));
  expect(recipe.steps[1]!.inputs).toEqual([expect.objectContaining({ from: 'step:0', sha256: entry.hd!.source_sha256 })]);
  expect(workflowSha256(hdWorkflow(library, entry.hd!, sampleOf('landscape-a').aspect))).toBe(entry.hd!.workflow_sha256);
  expect(recipe.weights.map((weight) => weight.id)).toEqual(expect.arrayContaining(['wan22-fun-camera-high', 'wan22-fun-camera-low']));
  expect(recipe.weights.some((weight) => weight.modelId === entry.hd!.model)).toBe(true);
  expect(findLocalPath(recipe)).toBeNull();
});

test('its request renders it again: the description, the negative and the seed, then the HD pass on what it made', () => {
  const entry = entryOf('crash-push', 'landscape-a');
  const recipe = recipeOf('crash-push', 'landscape-a');
  expect(recipe.request).toEqual({
    route: '/api/generations',
    body: { presetId: 'crash-push', modelId: manifest.model, userPrompt: entry.description, negative: entry.negative, seed: entry.seed },
    files: [{ field: 'imageRef', sha256: entry.image_sha256 }],
    then: [{ route: '/api/generations/:parent/upscale', body: { smooth: false, seed: entry.hd!.seed }, files: [] }],
  });
});

test('a manifest whose workflow sha256 is not the one the clip compiles to gives no recipe', () => {
  const entry = { ...entryOf('crash-push', 'landscape-a'), workflow_sha256: '0'.repeat(64) };
  expect(() => showcaseRecipe(library, manifest, entry, sampleOf('landscape-a'), yamlOf('crash-push'), stack)).toThrow(/workflow_sha256/);
});
