import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecipe, compactRecipe, type Recipe, type RecipeRequest } from '@montagio/recipe';
import { AI_IMAGE_METADATA, RECIPE_TAG, tagImage } from '@montagio/sequence';
import { MontagioClient } from '../src/client';
import { ToolFailure } from '../src/errors';
import { loadRecipe, reproduce, withPhoto } from '../src/reproduce';
import { TOOL_NAMES } from '../src/tools';
import { fakeClock, fakeFetch, reply, testConfig, type Call } from './fake-app';

let dir: string;
let photo: string;
let photoSha: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montagio-mcp-reproduce-'));
  photo = join(dir, 'harbour.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x9', '-frames:v', '1', photo]);
  photoSha = createHash('sha256').update(await readFile(photo)).digest('hex');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const STACK = { montagio: { version: '0.1.0', commit: 'a'.repeat(40) }, comfyui: { tag: 'v0.41.0', commit: 'b'.repeat(40) }, proxy: '0.1.6', nodes: [] };
const WORKFLOW = { '1': { class_type: 'LoadImage', inputs: { image: 'uploads/x.png' } }, '2': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 42 } } };

/** A camera clip's recipe, its request asking for `photoSha`; `then` follows on what it made. */
function cameraRecipe(sha: string | null, then?: RecipeRequest[]): Recipe {
  return buildRecipe(
    {
      kind: 'clip',
      task: 'camera',
      name: 'Slow Push',
      createdAt: '2026-10-24T18:00:00.000Z',
      backend: 'local',
      seed: 42,
      request: {
        route: '/api/generations',
        body: { presetId: 'slow-push', modelId: 'wan22-i2v-a14b-fun-camera', userPrompt: 'A harbour at dawn', seed: 42 },
        files: [{ field: 'imageRef', sha256: sha }],
        ...(then ? { then } : {}),
      },
      steps: [{ name: 'camera', workflow: WORKFLOW, inputs: [{ node: '1', field: 'image', from: 'imageRef', sha256: sha }] }],
      post: ['tag'],
    },
    { lock: [], models: [], stack: STACK },
  );
}

/** A fake Montagio: an upload, a camera clip g2 done at the first poll, an HD job j1, and the recipes it would give. */
function app(recipeHere: (path: string) => Recipe) {
  return fakeFetch((call: Call) => {
    if (call.method === 'POST' && call.path === '/api/uploads') {
      return reply({ imageRef: 'uploads/new.png', width: 16, height: 9, aspect: '16:9', origin: 'upload', personal: true }, 201);
    }
    if (call.method === 'POST' && call.path === '/api/generations') return reply({ id: 'g2', presetId: 'slow-push', modelId: 'm', state: 'queued', progress: 0 }, 201);
    if (call.path === '/api/generations/g2') return reply({ id: 'g2', presetId: 'slow-push', modelId: 'm', state: 'succeeded', progress: 1, outputUrl: '/media/data/generations/g2/clip.mp4' });
    if (call.method === 'POST' && call.path === '/api/generations/g2/upscale') return reply({ id: 'j1', task: 'upscale', state: 'queued', progress: 0, label: {}, modelId: 'seedvr2-upscale' }, 201);
    if (call.path === '/api/jobs/j1') return reply({ id: 'j1', task: 'upscale', state: 'succeeded', progress: 1, label: {}, modelId: 'seedvr2-upscale', outputUrl: '/media/data/jobs/j1/output.mp4' });
    if (call.method === 'POST' && call.path === '/api/jobs/g2/captions') return reply({ id: 'j2', task: 'captions', state: 'queued', progress: 0, label: {}, modelId: 'whisper-turbo-words' }, 201);
    if (call.path === '/api/jobs/j2') return reply({ id: 'j2', task: 'captions', state: 'succeeded', progress: 1, label: {}, modelId: 'whisper-turbo-words', outputUrl: '/media/data/jobs/j2/exports/x/video.mp4' });
    if (call.path.startsWith('/api/recipes/')) return reply(recipeHere(call.path));
    return reply({ error: 'not-found' }, 404);
  });
}

const clientOf = (fetch: ReturnType<typeof app>['fetch']) => {
  const clock = fakeClock();
  return new MontagioClient(testConfig(), { fetch, sleep: clock.sleep, now: clock.now });
};

test('a camera recipe is sent again with the same seed, preset, model and text, on the photo given', async () => {
  const recipe = cameraRecipe(photoSha);
  const { fetch, calls } = app(() => recipe);
  const result = await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } });
  const sent = calls.find((call) => call.method === 'POST' && call.path === '/api/generations')!;
  expect(sent.json).toEqual({ presetId: 'slow-push', modelId: 'wan22-i2v-a14b-fun-camera', userPrompt: 'A harbour at dawn', seed: 42, imageRef: 'uploads/new.png' });
  expect(sent.headers['idempotency-key']).toBeTruthy();
  expect(result).toMatchObject({ render: { kind: 'generation', id: 'g2', state: 'succeeded' }, sameInputs: { imageRef: true }, sameWorkflow: true });
  expect(result.note).toMatch(/identical result on the same setup/);
});

test('the workflow made here is compared with the recipe: another one says so', async () => {
  const recipe = cameraRecipe(photoSha);
  const other = structuredClone(recipe);
  other.steps[0]!.workflowSha256 = 'f'.repeat(64);
  const { fetch } = app(() => other);
  expect((await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } })).sameWorkflow).toBe(false);
});

test('another photo than the recipe one is said to differ', async () => {
  const recipe = cameraRecipe('0'.repeat(64));
  const { fetch } = app(() => recipe);
  expect((await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } })).sameInputs).toEqual({ imageRef: false });
});

test('the HD pass is asked for on the clip just made, smooth as in the recipe', async () => {
  const then = [{ route: '/api/generations/:parent/upscale', body: { smooth: true, seed: 5 }, files: [] }];
  const recipe = cameraRecipe(photoSha, then);
  const { fetch, calls } = app(() => recipe);
  const result = await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } });
  expect(calls.find((call) => call.path === '/api/generations/g2/upscale')?.json).toEqual({ smooth: true, seed: 5 });
  expect(result.render).toMatchObject({ kind: 'job', id: 'j1', task: 'upscale' });
  expect(calls.some((call) => call.path === '/api/recipes/job/j1')).toBe(true);
});

test('the captions of a clip follow it: the same corrected text, in the same style, burned in again', async () => {
  const then = [{ route: '/api/jobs/:parent/captions', body: { language: 'en', export: { text: 'A harbour at dawn.', style: 'pop' } }, files: [] }];
  const recipe = cameraRecipe(photoSha, then);
  const { fetch, calls } = app(() => recipe);
  const result = await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } });
  expect(calls.find((call) => call.path === '/api/jobs/g2/captions')?.json).toEqual({ language: 'en', export: { text: 'A harbour at dawn.', style: 'pop' } });
  expect(result.render).toMatchObject({ kind: 'job', id: 'j2', task: 'captions' });
});

test('a recipe without a request cannot be replayed here', async () => {
  const { request: _none, ...recipe } = cameraRecipe(photoSha);
  const { fetch } = app(() => cameraRecipe(photoSha));
  await expect(reproduce(clientOf(fetch), { recipe, inputs: {} })).rejects.toMatchObject({ code: 'not-replayable' });
});

test('without the photo it asks for, the recipe says which file it needs', async () => {
  const { fetch } = app(() => cameraRecipe(photoSha));
  const failure = await reproduce(clientOf(fetch), { recipe: cameraRecipe(photoSha), inputs: {} }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ToolFailure);
  expect(failure).toMatchObject({ code: 'inputs-required', details: { fields: ['imageRef'] } });
});

test('a recipe is read from a JSON file, and from the PNG that carries it', async () => {
  const recipe = cameraRecipe(photoSha);
  const json = join(dir, 'recipe.json');
  await writeFile(json, JSON.stringify(recipe));
  expect((await loadRecipe(json)).seed).toBe(42);
  const tagged = join(dir, 'tagged.png');
  await tagImage(photo, tagged, { ...AI_IMAGE_METADATA, [RECIPE_TAG.image]: compactRecipe(recipe) });
  const read = await loadRecipe(tagged);
  expect(read).toMatchObject({ compact: true, seed: 42, request: { route: '/api/generations' } });
  await expect(loadRecipe(join(dir, 'missing.json'))).rejects.toMatchObject({ code: 'invalid-recipe' });
});

describe('a recipe is a file from anywhere: it never speaks for the user', () => {
  /** The recipe's request with `change` applied, its hashes left as they are (the request is not hashed). */
  function tampered(change: (request: RecipeRequest) => void): Recipe {
    const recipe = cameraRecipe(photoSha);
    change(recipe.request!);
    return recipe;
  }

  test('a consent, a rights or a voice consent written in the recipe is dropped: only the call gives them', async () => {
    const recipe = tampered((request) => Object.assign(request.body, { consent: true, rights: true, voiceConsent: true }));
    const { fetch, calls } = app(() => recipe);
    await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } });
    const sent = calls.find((call) => call.method === 'POST' && call.path === '/api/generations')!.json!;
    expect(sent).not.toHaveProperty('consent');
    expect(sent).not.toHaveProperty('rights');
    expect(sent).not.toHaveProperty('voiceConsent');
    const { fetch: again, calls: second } = app(() => recipe);
    await reproduce(clientOf(again), { recipe, inputs: { imageRef: photo }, consent: true });
    expect(second.find((call) => call.path === '/api/generations')!.json).toMatchObject({ consent: true });
  });

  test('a file of this machine named in the body, beside the files the recipe asks for, is dropped', async () => {
    const recipe = tampered((request) => Object.assign(request.body, { image2Ref: 'uploads/someone-else.png', compose: { place: 'uploads/x.png' } }));
    const { fetch, calls } = app(() => recipe);
    await reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } });
    const sent = calls.find((call) => call.path === '/api/generations')!.json!;
    expect(sent).not.toHaveProperty('image2Ref');
    expect(sent).not.toHaveProperty('compose');
  });

  test.each([
    ['another route of the app', (request: RecipeRequest) => (request.route = '/api/characters')],
    ['a route that climbs', (request: RecipeRequest) => (request.route = '/api/generations/../uploads')],
    ['a follow-up route of its own', (request: RecipeRequest) => (request.then = [{ route: '/api/uploads/sample', body: {}, files: [] }])],
  ])('%s is refused before anything is sent', async (_name, change) => {
    const recipe = tampered(change);
    const { fetch, calls } = app(() => recipe);
    await expect(reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } })).rejects.toMatchObject({ code: 'invalid-recipe' });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  test('a recipe asks for one follow-up at most: a chain of renders is refused', async () => {
    const upscale = { route: '/api/generations/:parent/upscale', body: { smooth: true }, files: [] };
    const recipe = tampered((request) => (request.then = [upscale, { ...upscale, route: '/api/jobs/:parent/upscale' }]));
    const { fetch, calls } = app(() => recipe);
    await expect(reproduce(clientOf(fetch), { recipe, inputs: { imageRef: photo } })).rejects.toMatchObject({ code: 'invalid-recipe' });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  test('a file field that would reach an object prototype is refused', async () => {
    const recipe = tampered((request) => (request.files = [{ field: '__proto__.polluted', sha256: null }]));
    const { fetch } = app(() => recipe);
    await expect(reproduce(clientOf(fetch), { recipe, inputs: { '__proto__.polluted': photo } })).rejects.toMatchObject({ code: 'invalid-recipe' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

test('an avatar in the user\'s own voice: the sample goes to the voice route, and only the call says the speaker agreed', async () => {
  const voice = join(dir, 'voice.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', voice]);
  const recipe = buildRecipe(
    {
      kind: 'clip',
      task: 'avatar',
      name: 'Avatar',
      createdAt: '2026-10-24T18:00:00.000Z',
      backend: 'local',
      seed: 3,
      request: {
        route: '/api/avatars',
        body: { text: 'Hello there', language: 'en', seed: 3, voiceConsent: true },
        files: [{ field: 'imageRef', sha256: photoSha }, { field: 'voiceRef', sha256: 'e'.repeat(64) }],
      },
      steps: [{ name: 'speech', workflow: WORKFLOW, inputs: [{ node: '1', field: 'image', from: 'imageRef', sha256: photoSha }] }],
      post: ['tag'],
    },
    { lock: [], models: [], stack: STACK },
  );
  const avatarApp = () =>
    fakeFetch((call: Call) => {
      if (call.path === '/api/uploads') return reply({ imageRef: 'uploads/new.png', width: 16, height: 9, aspect: '16:9', origin: 'upload', personal: true }, 201);
      if (call.path === '/api/uploads/voice') return reply({ voiceRef: 'voices/v.flac', duration_s: 1 }, 201);
      if (call.method === 'POST' && call.path === '/api/avatars') return reply({ id: 'j1', task: 'avatar', state: 'queued', progress: 0, label: {}, modelId: 'm' }, 201);
      if (call.path === '/api/jobs/j1') return reply({ id: 'j1', task: 'avatar', state: 'succeeded', progress: 1, label: {}, modelId: 'm', outputUrl: '/media/data/jobs/j1/output.mp4' });
      if (call.path === '/api/recipes/job/j1') return reply(recipe);
      return reply({ error: 'not-found' }, 404);
    });
  const first = avatarApp();
  const result = await reproduce(clientOf(first.fetch), { recipe, inputs: { imageRef: photo, voiceRef: voice } });
  expect(first.calls.find((call) => call.path === '/api/uploads/voice')?.form?.get('audio')).toBeInstanceOf(Blob);
  const sent = first.calls.find((call) => call.path === '/api/avatars')!.json!;
  expect(sent).toMatchObject({ imageRef: 'uploads/new.png', voiceRef: 'voices/v.flac', text: 'Hello there' });
  expect(sent).not.toHaveProperty('voiceConsent');
  // The app prepares the sample (mono FLAC, 20 s): its sha256 cannot be the file's own.
  expect(result.sameInputs).toEqual({ imageRef: true, voiceRef: null });
  const second = avatarApp();
  await reproduce(clientOf(second.fetch), { recipe, inputs: { imageRef: photo, voiceRef: voice }, voiceConsent: true });
  expect(second.calls.find((call) => call.path === '/api/avatars')!.json).toMatchObject({ voiceConsent: true });
});

test("a trend remix: the user's trend goes to the remix route, its cuts and shots replayed, never its sound nor the face box", async () => {
  const trend = join(dir, 'trend.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x112:rate=16:duration=1', '-pix_fmt', 'yuv420p', trend]);
  const recipe = buildRecipe(
    {
      kind: 'clip',
      task: 'remix',
      name: 'Remix',
      createdAt: '2026-10-25T18:00:00.000Z',
      backend: 'local',
      seed: 5,
      request: {
        route: '/api/remix',
        // A tampered recipe that would keep the trend's sound and tick the boxes: all of it is dropped.
        body: { mode: 'motion', cuts: [8], shots: [{ keep: false }, { keep: true }], language: 'en', seed: 5, keepSound: true, soundRights: true, faceConsent: true },
        files: [{ field: 'remixRef', sha256: 'f'.repeat(64) }, { field: 'imageRef', sha256: photoSha }],
      },
      steps: [{ name: 'shot 1', workflow: WORKFLOW, inputs: [{ node: '1', field: 'image', from: 'imageRef', sha256: photoSha }] }],
      post: ['assemble-shots', 'vertical', 'tag'],
    },
    { lock: [], models: [], stack: STACK },
  );
  const remixApp = () =>
    fakeFetch((call: Call) => {
      if (call.path === '/api/uploads') return reply({ imageRef: 'uploads/new.png', width: 16, height: 9, aspect: '16:9', origin: 'upload', personal: true }, 201);
      if (call.path === '/api/uploads/remix') return reply({ remixRef: 'remix/00000000-0000-0000-0000-000000000000.mp4', frames: 16, fps: 16, cuts: [8] }, 201);
      if (call.method === 'POST' && call.path === '/api/remix') return reply({ id: 'j2', task: 'remix', state: 'queued', progress: 0, label: {}, modelId: 'm' }, 201);
      if (call.path === '/api/jobs/j2') return reply({ id: 'j2', task: 'remix', state: 'succeeded', progress: 1, label: {}, modelId: 'm', outputUrl: '/media/data/jobs/j2/remix.mp4' });
      if (call.path === '/api/recipes/job/j2') return reply(recipe);
      return reply({ error: 'not-found' }, 404);
    });
  // The photo fills the character's place, never the trend's.
  expect(withPhoto(recipe, { remixRef: trend }, photo)).toEqual({ remixRef: trend, imageRef: photo });
  const first = remixApp();
  const result = await reproduce(clientOf(first.fetch), { recipe, inputs: { remixRef: trend, imageRef: photo } });
  expect(first.calls.find((call) => call.path === '/api/uploads/remix')?.form?.get('video')).toBeInstanceOf(Blob);
  const sent = first.calls.find((call) => call.path === '/api/remix')!.json!;
  expect(sent).toMatchObject({ remixRef: 'remix/00000000-0000-0000-0000-000000000000.mp4', imageRef: 'uploads/new.png', cuts: [8], shots: [{ keep: false }, { keep: true }], seed: 5 });
  for (const key of ['keepSound', 'soundRights', 'faceConsent', 'rights']) expect(sent).not.toHaveProperty(key);
  // The app keeps the trend's first 60 s at its own frame rate: its sha256 cannot be the file's own.
  expect(result.sameInputs).toEqual({ remixRef: null, imageRef: true });
  const second = remixApp();
  await reproduce(clientOf(second.fetch), { recipe, inputs: { remixRef: trend, imageRef: photo }, rights: true, faceConsent: true });
  expect(second.calls.find((call) => call.path === '/api/remix')!.json).toMatchObject({ rights: true, faceConsent: true });
});

test('the MCP server lists get_recipe and reproduce', () => {
  expect(TOOL_NAMES).toContain('get_recipe');
  expect(TOOL_NAMES).toContain('reproduce');
});
