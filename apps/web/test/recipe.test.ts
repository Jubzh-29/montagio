import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { findLocalPath, normalizeWorkflow, workflowSha256, type Recipe } from '@montagio/recipe';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { POST as postEffects } from '@/app/api/effects/route';
import { POST as postGeneration } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as upscaleGeneration } from '@/app/api/generations/[id]/upscale/route';
import { GET as getHistory } from '@/app/api/history/route';
import { POST as postEdits } from '@/app/api/edits/route';
import { POST as postHooks } from '@/app/api/hooks/route';
import { POST as postImages } from '@/app/api/images/route';
import { POST as postMotion } from '@/app/api/motion/route';
import { POST as postRestyle } from '@/app/api/restyle/route';
import { POST as postSwap } from '@/app/api/swap/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { GET as getRecipe } from '@/app/api/recipes/[source]/[id]/route';
import { POST as postSequence } from '@/app/api/sequences/route';
import { GET as getSequence } from '@/app/api/sequences/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postSampleVideo } from '@/app/api/uploads/video/sample/route';
import type { HistoryItem } from '@/lib/api-types';
import { getServices, resetServicesForTests } from '@/server/services';
import { readInputs, readWorkflow } from '@/server/store';
import { generationRequest, params, setupTempData } from './helpers';

const dataDir = setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const jsonRequest = (route: string, body: unknown, key: string) =>
  new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const recipeResponse = (source: string, id: string, query = '') => getRecipe(new Request(`http://localhost/api/recipes/${source}/${id}${query}`), params({ source, id }));
const recipeOf = async (source: string, id: string) => (await (await recipeResponse(source, id)).json()) as Recipe;

async function settledGeneration(body: Record<string, unknown>, key: string): Promise<{ id: string; seed: number }> {
  const { id } = (await (await postGeneration(generationRequest(body, key))).json()) as { id: string };
  let record: { state: string; seed: number } = { state: 'queued', seed: -1 };
  for (let i = 0; i < 20 && record.state !== 'succeeded'; i++) record = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
  expect(record.state).toBe('succeeded');
  return { id, seed: record.seed };
}

async function settledJob(created: Response): Promise<string> {
  const { id } = (await created.json()) as { id: string };
  let state = '';
  for (let i = 0; i < 20 && !['succeeded', 'failed'].includes(state); i++) {
    state = ((await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as { state: string }).state;
  }
  expect(state).toBe('succeeded');
  return id;
}

async function settledFilm(imageRef: string): Promise<string> {
  const body = { imageRef, shots: [{ presetId: 'slow-push', seed: 7 }, { presetId: 'pan-left', seed: 8 }] };
  const { id } = (await (await postSequence(jsonRequest('/api/sequences', body, 'film-recipe'))).json()) as { id: string };
  let state = '';
  for (let i = 0; i < 300 && !['succeeded', 'failed'].includes(state); i++) {
    state = ((await (await getSequence(new Request('http://localhost/x'), params({ id }))).json()) as { state: string }).state;
    if (state === 'assembling') await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(state).toBe('succeeded');
  return id;
}

/** Nothing of the machine: no local path, no data folder, no upload of this photo. */
function expectNothingLocal(recipe: Recipe, imageRef: string): void {
  const text = JSON.stringify(recipe);
  expect(findLocalPath(recipe)).toBeNull();
  expect(text).not.toContain(dataDir());
  expect(text).not.toContain(dataDir().replaceAll('\\', '\\\\'));
  expect(text).not.toContain(imageRef);
  expect(text).not.toContain(imageRef.split('/').at(-1)!.split('.')[0]!);
}

describe('the recipe of a camera clip', () => {
  test('its workflow, seed, weights, preset, stack and the request that makes it again', async () => {
    const imageRef = await sampleRef();
    const { id, seed } = await settledGeneration({ presetId: 'slow-push', imageRef, userPrompt: 'A harbour at dawn' }, 'rc-gen');
    const res = await recipeResponse('generation', id);
    expect(res.status).toBe(200);
    const recipe = (await res.json()) as Recipe;
    const lib = await getServices().library;
    expect(recipe).toMatchObject({ schema: 'montagio/recipe@1', kind: 'clip', task: 'camera', name: 'Slow Push', seed, backend: 'demo' });
    expect(recipe.steps[0]!.workflowSha256).toBe(workflowSha256(normalizeWorkflow((await readWorkflow(id))!, (await readInputs(id))!)));
    // Slow Push starts on the Turbo: its LoRAs are among the weights.
    const camera = lib.models.get('wan22-i2v-a14b-fun-camera-turbo')!;
    for (const weightId of camera.weights) {
      expect(recipe.weights).toContainEqual(expect.objectContaining({ id: weightId, sha256: lib.lock.get(weightId)!.sha256, modelId: camera.id }));
    }
    expect(recipe.preset).toEqual({ id: 'slow-push', remix: false, sha256: sha(readFileSync(join(process.env.MONTAGIO_ROOT!, 'presets', 'slow-push.yaml'))) });
    expect(recipe.presetYaml).toContain('slow-push');
    expect(recipe.stack.comfyui.tag).toBe('v0.41.0');
    expect(recipe.request).toEqual({
      route: '/api/generations',
      body: { presetId: 'slow-push', modelId: 'wan22-i2v-a14b-fun-camera-turbo', userPrompt: 'A harbour at dawn', seed },
      files: [{ field: 'imageRef', sha256: sha(readFileSync(join(dataDir(), ...imageRef.split('/')))) }],
    });
    expect(recipe.reprise).toMatchObject({ tab: 'camera', presetId: 'slow-push', seed });
    expect(recipe.reprise).not.toHaveProperty('imageRef');
    expect(recipe.output?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test('downloads as a file named after its task and id', async () => {
    const { id } = await settledGeneration({ presetId: 'slow-push', imageRef: await sampleRef() }, 'rc-dl');
    const res = await recipeResponse('generation', id, '?download=1');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="montagio-recipe-camera-${id}.json"`);
  }, 30_000);

  test('a clip rendered before the inputs were noted still has its recipe, with no sha256 for the photo', async () => {
    const imageRef = await sampleRef();
    const { id } = await settledGeneration({ presetId: 'slow-push', imageRef }, 'rc-old');
    rmSync(join(dataDir(), 'generations', id, 'inputs.json'));
    // Nor was its recipe written at delivery then.
    rmSync(join(dataDir(), 'generations', id, 'recipe.json'));
    const res = await recipeResponse('generation', id);
    expect(res.status).toBe(200);
    const recipe = (await res.json()) as Recipe;
    expect(recipe.steps[0]!.inputs).toEqual([expect.objectContaining({ from: 'imageRef', sha256: null })]);
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test('the photo deleted after the render: the recipe keeps its sha256', async () => {
    const imageRef = await sampleRef();
    const photoSha = sha(readFileSync(join(dataDir(), ...imageRef.split('/'))));
    const { id } = await settledGeneration({ presetId: 'slow-push', imageRef }, 'rc-gone');
    rmSync(join(dataDir(), 'uploads'), { recursive: true, force: true });
    expect((await recipeOf('generation', id)).steps[0]!.inputs[0]!.sha256).toBe(photoSha);
  }, 30_000);

  test('the recipe is the one written at delivery: a later version of Montagio does not change it', async () => {
    const { id } = await settledGeneration({ presetId: 'slow-push', imageRef: await sampleRef() }, 'rc-snapshot');
    const before = await recipeOf('generation', id);
    expect(existsSync(join(dataDir(), 'generations', id, 'recipe.json'))).toBe(true);
    // A git pull and a restart later: another commit.
    delete (globalThis as { __montagioStacks?: unknown }).__montagioStacks;
    process.env.MONTAGIO_COMMIT = 'f'.repeat(40);
    try {
      const after = await recipeOf('generation', id);
      expect(after.stack.montagio.commit).toBe(before.stack.montagio.commit);
      expect(after.stack.montagio.commit).not.toBe('f'.repeat(40));
    } finally {
      delete process.env.MONTAGIO_COMMIT;
      delete (globalThis as { __montagioStacks?: unknown }).__montagioStacks;
    }
  }, 30_000);

  test('an unknown id or source is not found', async () => {
    expect((await recipeResponse('generation', '00000000-0000-4000-8000-00000000dead')).status).toBe(404);
    expect((await recipeResponse('nothing', 'x')).status).toBe(404);
  });
});

describe('the recipe of the other results', () => {
  test('an effect: its preset, its one step and its request', async () => {
    const imageRef = await sampleRef();
    const id = await settledJob(await postEffects(jsonRequest('/api/effects', { imageRef, effectId: 'squish', subject: 'a toy car' }, 'rc-fx')));
    const recipe = await recipeOf('job', id);
    expect(recipe).toMatchObject({ kind: 'clip', task: 'effect', preset: { id: 'squish', remix: false } });
    expect(recipe.steps.map((step) => step.name)).toEqual(['effect']);
    expect(recipe.request).toMatchObject({ route: '/api/effects', body: { effectId: 'squish', subject: 'a toy car', seed: recipe.seed }, files: [{ field: 'imageRef' }] });
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test("a job's recipe names the backend that rendered it, after the app runs on another", async () => {
    const id = await settledJob(await postEffects(jsonRequest('/api/effects', { imageRef: await sampleRef(), effectId: 'squish' }, 'rc-backend')));
    // As if made before recipes were written at delivery.
    rmSync(join(dataDir(), 'jobs', id, 'recipe.json'), { force: true });
    process.env.MONTAGIO_BACKEND = 'local';
    process.env.COMFY_BASE_URL = 'http://127.0.0.1:9';
    resetServicesForTests();
    try {
      expect((await recipeOf('job', id)).backend).toBe('demo');
    } finally {
      process.env.MONTAGIO_BACKEND = 'demo';
      delete process.env.COMFY_BASE_URL;
      resetServicesForTests();
    }
  }, 30_000);

  test('a job made before this feature, without its inputs noted, still has its recipe and leaks nothing', async () => {
    const imageRef = await sampleRef();
    const id = await settledJob(await postEffects(jsonRequest('/api/effects', { imageRef, effectId: 'squish' }, 'rc-old-job')));
    rmSync(join(dataDir(), 'jobs', id, 'step0.inputs.json'));
    rmSync(join(dataDir(), 'jobs', id, 'recipe.json'), { force: true });
    const recipe = await recipeOf('job', id);
    expect(recipe.steps[0]!.inputs).toEqual([expect.objectContaining({ from: 'imageRef', sha256: null })]);
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test('a hook: the second step takes the first one output', async () => {
    const imageRef = await sampleRef();
    const id = await settledJob(await postHooks(jsonRequest('/api/hooks', { imageRef, hookId: 'iris-dive' }, 'rc-hook')));
    const recipe = await recipeOf('job', id);
    expect(recipe.steps).toHaveLength(2);
    expect(recipe.steps[1]!.inputs.map((slot) => slot.from)).toContain('step:0');
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test('a photo from a text, an edit and a motion transfer leak nothing either', async () => {
    const t2i = await settledJob(await postImages(jsonRequest('/api/images', { prompt: 'A lighthouse at dusk', aspect: '16:9' }, 'rc-t2i')));
    expect(findLocalPath(await recipeOf('job', t2i))).toBeNull();
    const imageRef = await sampleRef();
    const edit = await settledJob(await postEdits(jsonRequest('/api/edits', { imageRef, instruction: 'make the sky purple' }, 'rc-edit')));
    expectNothingLocal(await recipeOf('job', edit), imageRef);
    const { videoRef } = (await (await postSampleVideo()).json()) as { videoRef: string };
    const motion = await settledJob(await postMotion(jsonRequest('/api/motion', { imageRef, videoRef }, 'rc-motion')));
    const recipe = await recipeOf('job', motion);
    expectNothingLocal(recipe, imageRef);
    expect(JSON.stringify(recipe)).not.toContain(videoRef);
    expect(recipe.request?.files.map((file) => file.field)).toEqual(['imageRef', 'videoRef']);
  }, 60_000);

  test("a restyle and an object swap: their text, the swap's points, the clip and the image, never the rights", async () => {
    const imageRef = await sampleRef();
    const { videoRef } = (await (await postSampleVideo()).json()) as { videoRef: string };
    const restyle = await settledJob(await postRestyle(jsonRequest('/api/restyle', { videoRef, imageRef, prompt: 'a watercolor painting', rights: true }, 'rc-restyle')));
    const restyled = await recipeOf('job', restyle);
    expect(restyled.request).toMatchObject({ route: '/api/restyle', body: { prompt: 'a watercolor painting', seed: restyled.seed } });
    expect(restyled.request?.body).not.toHaveProperty('rights');
    expect(restyled.request?.files.map((file) => file.field)).toEqual(['imageRef', 'videoRef']);
    expectNothingLocal(restyled, imageRef);
    const points = [{ x: 0.5, y: 0.4 }];
    const swap = await settledJob(await postSwap(jsonRequest('/api/swap', { videoRef, prompt: 'a red motorbike', points, rights: true }, 'rc-swap')));
    const swapped = await recipeOf('job', swap);
    expect(swapped.request).toMatchObject({ route: '/api/swap', body: { prompt: 'a red motorbike', points, seed: swapped.seed } });
    expect(swapped.request?.body).not.toHaveProperty('rights');
    expect(swapped.request?.files.map((file) => file.field)).toEqual(['videoRef']);
    expect(JSON.stringify(swapped)).not.toContain(videoRef);
  }, 60_000);

  test('an avatar: its text, its language and its seed', async () => {
    const imageRef = await sampleRef();
    const text = 'Hello, this is a short line to say.';
    const id = await settledJob(await postAvatars(jsonRequest('/api/avatars', { imageRef, text, language: 'en' }, 'rc-av')));
    const recipe = await recipeOf('job', id);
    expect(recipe.request).toMatchObject({ route: '/api/avatars', body: { text, language: 'en', seed: recipe.seed } });
    expectNothingLocal(recipe, imageRef);
  }, 30_000);

  test('an HD clip: the steps of its clip, then the upscale, which the request asks for once that clip is made', async () => {
    const imageRef = await sampleRef();
    const { id: clip } = await settledGeneration({ presetId: 'slow-push', imageRef }, 'rc-hd-clip');
    const hd = new Request('http://localhost/x', { method: 'POST', headers: { 'idempotency-key': 'rc-hd' }, body: JSON.stringify({ smooth: true }) });
    const id = await settledJob(await upscaleGeneration(hd, params({ id: clip })));
    const recipe = await recipeOf('job', id);
    expect(recipe.steps.map((step) => step.name)).toEqual(['camera', 'upscale']);
    expect(recipe.steps[1]!.inputs).toEqual([expect.objectContaining({ from: 'step:0' })]);
    expect(recipe.request).toMatchObject({ route: '/api/generations', then: [{ route: '/api/generations/:parent/upscale', body: { smooth: true, seed: recipe.seed } }] });
    expect(recipe.weights.map((weight) => weight.id)).toContain('rife-v4-26');
    expectNothingLocal(recipe, imageRef);
    // Reproduce on this HD clip reopens its clip: that clip's recipe is the one a new render compares with.
    const items = (await (await getHistory()).json()) as HistoryItem[];
    expect(items.find((item) => item.key === `job:${id}`)?.reproduces).toBe(`/api/recipes/generation/${clip}`);
  }, 60_000);

  test('a film: one step per shot, each shot after the first starts on the last frame of the one before', async () => {
    const imageRef = await sampleRef();
    const id = await settledFilm(imageRef);
    const recipe = await recipeOf('sequence', id);
    expect(recipe).toMatchObject({ kind: 'film', task: 'film', seed: 7 });
    expect(recipe.steps.map((step) => step.name)).toEqual(['shot 1', 'shot 2']);
    expect(recipe.steps[1]!.inputs[0]!.from).toBe('frame:0');
    expect(recipe.request).toMatchObject({ route: '/api/sequences', body: { shots: [{ presetId: 'slow-push', seed: 7 }, { presetId: 'pan-left', seed: 8 }] } });
    expect(recipe.post).toEqual(['tag', 'last-frame', 'concat', 'vertical']);
    expectNothingLocal(recipe, imageRef);
  }, 60_000);
});

test('History gives each creation its recipe and its seed, and a film the seed of each shot', async () => {
  const imageRef = await sampleRef();
  const { id, seed } = await settledGeneration({ presetId: 'slow-push', imageRef }, 'rc-history');
  const film = await settledFilm(imageRef);
  const items = (await (await getHistory()).json()) as HistoryItem[];
  const clip = items.find((item) => item.key === `generation:${id}`)!;
  expect(clip.recipeUrl).toBe(`/api/recipes/generation/${id}`);
  expect(clip.reprise.seed).toBe(seed);
  const filmItem = items.find((item) => item.key === `sequence:${film}`)!;
  expect(filmItem.recipeUrl).toBe(`/api/recipes/sequence/${film}`);
  expect(filmItem.reprise.shots?.map((shot) => shot.seed)).toEqual([7, 8]);
}, 60_000);
