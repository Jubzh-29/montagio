import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST as postCharacter } from '@/app/api/characters/route';
import { POST as postFace } from '@/app/api/uploads/face/route';
import type { CharacterSummary } from '@/lib/api-types';
import { CHARACTER_BANK, FACES_WITH_PICTURE, facePrompt, faceScene, SHOWCASE_FACES, STARTING_FACES } from '@/lib/character-bank';
import { PORTRAIT_PROMPT_MAX } from '@/lib/characters';
import { faceRecipe, faceWorkflow } from '@/server/character-bank';
import { blockedNames, findBlockedName } from '@/server/guards';
import { loadLibrary } from '@montagio/presets';
import { workflowSha256, type Recipe, type RecipeStack } from '@montagio/recipe';
import { repoRoot, setupTempData } from './helpers';

setupTempData();

const STACK: RecipeStack = { montagio: { version: '0.0.0', commit: null }, comfyui: { tag: 'v0.41.0', commit: 'test' }, proxy: 'test', nodes: [] };
const faceRequest = (id: string) => new Request(`http://localhost/api/uploads/face?id=${encodeURIComponent(id)}`, { method: 'POST' });

test('the bank holds 24 to 30 faces, each with its own id and seed, off the norm in kind and style', () => {
  expect(CHARACTER_BANK.length).toBeGreaterThanOrEqual(24);
  expect(CHARACTER_BANK.length).toBeLessThanOrEqual(30);
  expect(new Set(CHARACTER_BANK.map((face) => face.id)).size).toBe(CHARACTER_BANK.length);
  expect(new Set(CHARACTER_BANK.map((face) => face.seed)).size).toBe(CHARACTER_BANK.length);
  for (const face of CHARACTER_BANK) {
    expect(face.id).toMatch(/^[a-z0-9-]+$/);
    expect(face.seed).toBeLessThan(2 ** 32);
  }
  const count = (test: (face: (typeof CHARACTER_BANK)[number]) => boolean) => CHARACTER_BANK.filter(test).length;
  expect(count((face) => face.kind === 'human' && ['bold', 'extreme'].includes(face.style))).toBeGreaterThanOrEqual(5);
  expect(count((face) => !['human', 'robot', 'alien'].includes(face.kind))).toBeGreaterThanOrEqual(6);
  expect(count((face) => face.kind === 'robot')).toBeGreaterThanOrEqual(3);
  expect(count((face) => face.kind === 'alien')).toBeGreaterThanOrEqual(3);
  expect(count((face) => face.style === 'clay')).toBeGreaterThanOrEqual(2);
  expect(count((face) => face.style === 'anime')).toBeGreaterThanOrEqual(2);
  // Every face carries a trait: the bank shows them off.
  expect(count((face) => Object.keys(face.traits).length > 0)).toBe(CHARACTER_BANK.length);
});

test('a face is the Characters tab\'s own text, whole (no word cut), clothed, and names no listed person', async () => {
  const names = await blockedNames();
  for (const face of CHARACTER_BANK) {
    const prompt = facePrompt(face);
    expect(prompt.length).toBeLessThanOrEqual(PORTRAIT_PROMPT_MAX);
    expect(prompt).toContain(`: ${face.details}. Fully clothed in a modest outfit`);
    expect(findBlockedName(`${face.name} ${prompt}`, names)).toBeNull();
    expect(faceScene(face)).toContain(face.details);
    expect(faceScene(face).length).toBeLessThanOrEqual(500);
  }
});

test('the recipe of a face is the request that renders it again, on the workflow the Studio compiles', async () => {
  const lib = await loadLibrary(repoRoot);
  const face = CHARACTER_BANK[0]!;
  const recipe = faceRecipe(lib, face, STACK, '2026-10-25T10:00:00.000Z', new Uint8Array([1, 2, 3]));
  expect(recipe).toMatchObject({
    schema: 'montagio/recipe@1',
    kind: 'photo',
    task: 't2i',
    name: face.name,
    seed: face.seed,
    request: { route: '/api/images', body: { prompt: facePrompt(face), aspect: '9:16', seed: face.seed }, files: [] },
    post: ['face-jpeg'],
    output: { sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' },
  });
  expect(recipe.steps).toHaveLength(1);
  expect(recipe.steps[0]!.workflowSha256).toBe(workflowSha256(faceWorkflow(lib, face)));
  expect(recipe.steps[0]!.settings).toMatchObject({ width: 720, height: 1280, seeds: [face.seed], texts: [facePrompt(face)] });
  expect(recipe.models.map((model) => model.id)).toEqual(['z-image-turbo']);
  expect(recipe.weights.length).toBeGreaterThan(0);
  for (const weight of recipe.weights) expect(['Apache-2.0', 'MIT']).toContain(weight.license);
});

test('a face is copied as a fictional sample that a character may be made of; a face without its picture answers 404', async () => {
  expect((await postFace(faceRequest('nobody'))).status).toBe(404);
  for (const face of CHARACTER_BANK.filter((entry) => !FACES_WITH_PICTURE.includes(entry.id)).slice(0, 1)) {
    expect((await postFace(faceRequest(face.id))).status).toBe(404);
  }
  for (const face of STARTING_FACES.slice(0, 1)) {
    const res = await postFace(faceRequest(face.id));
    expect(res.status).toBe(201);
    const upload = (await res.json()) as { imageRef: string; origin: string; personal: boolean; fictional?: boolean; aspect: string };
    expect(upload).toMatchObject({ origin: 'sample', personal: false, fictional: true, aspect: '9:16' });
    const saved = await postCharacter(
      new Request('http://localhost/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: face.name, type: face.style, kind: face.kind, traits: face.traits, description: face.details, imageRef: upload.imageRef, faceId: face.id }),
      }),
    );
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ faceId: face.id, traits: face.traits, portraitHistoryKey: `face:${face.id}` } satisfies Partial<CharacterSummary>);
  }
});

test('every face that ships has its photo, its thumbnail and the recipe of that very photo', () => {
  for (const id of SHOWCASE_FACES) expect(FACES_WITH_PICTURE).toContain(id);
  for (const id of FACES_WITH_PICTURE) {
    const face = CHARACTER_BANK.find((entry) => entry.id === id);
    expect(face, id).toBeDefined();
    expect(existsSync(join(repoRoot, 'demo-assets', 'faces', `${id}.jpg`)), id).toBe(true);
    expect(existsSync(join(repoRoot, 'apps', 'web', 'public', 'characters', 'faces', `${id}.webp`)), id).toBe(true);
    const recipe = JSON.parse(readFileSync(join(repoRoot, 'demo-assets', 'faces', `${id}.recipe.json`), 'utf8')) as Recipe;
    expect(recipe.request?.body).toEqual({ prompt: facePrompt(face!), aspect: '9:16', seed: face!.seed });
  }
});
