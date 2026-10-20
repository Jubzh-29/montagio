import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary, type Library } from '@montagio/presets';
import { AI_METADATA, PLACEHOLDER_METADATA } from '@montagio/sequence/tags';
import type { ShowcaseData } from '@montagio/showcase/data';
import { createShowcaseFetch } from '@/showcase/client';
import { createShowcaseRouter, type ShowcaseRouter } from '@/showcase/router';
import { MontageError, type Montage, type MontageJob, type MontageStage } from '@/showcase/types';
import type { ExtensionsInfo, HistoryItem } from '@/lib/api-types';
import { repoRoot } from './helpers';

let library: Library;
beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

function showcaseData(): ShowcaseData {
  const preset = (id: string) => {
    const p = library.presets.get(id)!;
    return {
      id,
      name: p.name,
      description: p.description,
      poses: [...p.camera.poses],
      speed: p.camera.speed,
      defaultModel: p.models.preferred,
      preview: `previews/${id}.mp4`,
      yaml: readFileSync(join(repoRoot, 'presets', `${id}.yaml`), 'utf8'),
    };
  };
  const clip = (presetId: string, placeholder: boolean) => ({
    preset: presetId,
    sample: 'landscape-a',
    url: `clips/${presetId}--landscape-a.mp4`,
    verticalUrl: `clips/${presetId}--landscape-a.9x16.mp4`,
    workflowUrl: `workflows/${presetId}--landscape-a.json`,
    placeholder,
  });
  return {
    schema: 'montagio/showcase-data@0.1',
    builtAt: '2026-10-18T20:00:00.000Z',
    repoUrl: 'https://example.org/montagio',
    model: { id: 'wan22-i2v-a14b-fun-camera', name: 'Wan 2.2 Fun Camera', license: 'Apache-2.0' },
    // Listed out of gallery order on purpose.
    presets: [preset('pan-left'), preset('crash-push')],
    models: [...library.models.values()].map((m) => ({ id: m.id, name: m.name, kind: m.kind, tier: m.tier, license: m.license, estimate_s: m.estimate_s })),
    library: { models: [...library.models], templates: [...library.templates], lock: [...library.lock] },
    samples: [
      { id: 'landscape-a', title: { en: 'Harbour', fr: 'Port' }, aspect: '16:9', url: 'samples/landscape-a.jpg', placeholder: false, credit: 'Z-Image-Turbo' },
    ],
    clips: [clip('crash-push', false), clip('pan-left', true)],
    effects: [],
    hooks: [],
    openStack: { ok: true, checkedAt: '2026-10-18T20:00:00.000Z', models: [], violations: [] },
  };
}

/** A montage the test drives: it reports a stage, then waits for finish() or fail(). */
function controllableMontage() {
  const jobs: MontageJob[] = [];
  let settle: { resolve: (v: { film: Blob; vertical: Blob }) => void; reject: (e: unknown) => void; onStage: (s: MontageStage) => void } | null = null;
  let lastSignal: AbortSignal | null = null;
  const montage: Montage = {
    preload: vi.fn(),
    assemble: (job, signal, onStage) =>
      new Promise((resolve, reject) => {
        jobs.push(job);
        lastSignal = signal;
        onStage('loading-ffmpeg');
        settle = { resolve, reject, onStage };
        signal.addEventListener('abort', () => reject(new MontageError('canceled')));
      }),
  };
  return {
    montage,
    jobs,
    signal: () => lastSignal,
    stage: (stage: MontageStage) => settle!.onStage(stage),
    finish: () => settle!.resolve({ film: new Blob(['film'], { type: 'video/mp4' }), vertical: new Blob(['cut'], { type: 'video/mp4' }) }),
    fail: (code: 'ffmpeg-unavailable' | 'ffmpeg-failed') => settle!.reject(new MontageError(code)),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function call(router: ShowcaseRouter, method: string, path: string, body?: unknown) {
  const res = await router(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (a YAML file, an empty body)
  }
  return { status: res.status, json: json as Record<string, unknown> & { [key: string]: unknown }, text, type: res.headers.get('content-type') };
}

const film = { imageRef: 'samples/landscape-a', shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] };

test('lists presets in gallery order with their light preview', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage, base: '/montagio' });
  const { status, json } = await call(router, 'GET', '/api/presets');
  expect(status).toBe(200);
  const presets = json as unknown as { id: string; previewUrl: string; poses: string[] }[];
  expect(presets.map((p) => p.id)).toEqual(['crash-push', 'pan-left']);
  expect(presets[0]).toMatchObject({ previewUrl: '/montagio/showcase/previews/crash-push.mp4', poses: ['zoom_in'] });
  // The tile says when its loop is a placeholder (crash-push is rendered in this fixture, pan-left is not).
  expect(presets.map((p) => (p as { previewPlaceholder?: boolean }).previewPlaceholder)).toEqual([false, true]);
  expect((await call(router, 'GET', '/api/models')).json).toHaveLength(3);
  expect((await call(router, 'GET', '/api/open-stack')).json).toMatchObject({ ok: true });
  const yaml = await call(router, 'GET', '/api/presets/crash-push/yaml');
  expect(yaml.type).toMatch(/^application\/yaml/);
  expect(yaml.text).toContain('id: crash-push');
  expect((await call(router, 'GET', '/api/presets/nowhere/yaml')).status).toBe(404);
});

test('describes the showcase: samples, model and what it cannot do', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage, base: '' });
  const { json } = await call(router, 'GET', '/api/showcase');
  expect(json).toEqual({
    samples: [
      { id: 'landscape-a', title: { en: 'Harbour', fr: 'Port' }, aspect: '16:9', imageRef: 'samples/landscape-a', url: '/showcase/samples/landscape-a.jpg', placeholder: false },
    ],
    model: { id: 'wan22-i2v-a14b-fun-camera', name: 'Wan 2.2 Fun Camera', license: 'Apache-2.0' },
    capabilities: { uploads: false, remixRender: false },
    placeholders: true,
    repoUrl: 'https://example.org/montagio',
  });
});

test('a known pair answers a succeeded generation with its clip and workflow URLs', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage, base: '' });
  const created = await call(router, 'POST', '/api/generations', {
    presetId: 'crash-push',
    modelId: 'wan22-i2v-a14b-fun-camera',
    imageRef: 'samples/landscape-a',
  });
  expect(created.status).toBe(201);
  expect(created.json).toMatchObject({
    presetId: 'crash-push',
    modelId: 'wan22-i2v-a14b-fun-camera',
    state: 'succeeded',
    progress: 1,
    outputUrl: '/showcase/clips/crash-push--landscape-a.mp4',
    workflowUrl: '/showcase/workflows/crash-push--landscape-a.json',
    placeholder: false,
  });
  const id = created.json.id as string;
  expect((await call(router, 'GET', `/api/generations/${id}`)).json).toEqual(created.json);
  expect((await call(router, 'POST', `/api/generations/${id}/cancel`)).json).toEqual(created.json);
  expect((await call(router, 'GET', `/api/generations/${id}/preset`)).status).toBe(404);
  expect((await call(router, 'GET', '/api/generations/nowhere')).status).toBe(404);
  const placeholder = await call(router, 'POST', '/api/generations', { presetId: 'pan-left', imageRef: 'samples/landscape-a' });
  expect(placeholder.json).toMatchObject({ placeholder: true, modelId: 'wan22-i2v-a14b-fun-camera' });
});

test("refuses another model, an unknown pair, an upload and a remix render with the server's codes", async () => {
  const data = showcaseData();
  data.clips = data.clips.filter((clip) => clip.preset !== 'pan-left');
  const router = createShowcaseRouter(data, { montage: controllableMontage().montage, base: '' });
  const generate = (body: unknown) => call(router, 'POST', '/api/generations', body);
  expect(await generate({ presetId: 'crash-push', modelId: 'wan22-ti2v-5b', imageRef: 'samples/landscape-a' })).toMatchObject({
    status: 400,
    json: { error: 'model-not-in-showcase' },
  });
  expect(await generate({ presetId: 'pan-left', imageRef: 'samples/landscape-a' })).toMatchObject({ status: 400, json: { error: 'not-in-showcase' } });
  expect(await generate({ presetId: 'nowhere', imageRef: 'samples/landscape-a' })).toMatchObject({ status: 400, json: { error: 'unknown-preset' } });
  expect(await generate({ presetId: 'crash-push', imageRef: 'uploads/x.png' })).toMatchObject({ status: 400, json: { error: 'unknown-image' } });
  expect(await generate({ presetYaml: 'id: x', imageRef: 'samples/landscape-a' })).toMatchObject({ status: 403, json: { error: 'showcase-remix' } });
  expect(await call(router, 'POST', '/api/uploads')).toMatchObject({ status: 403, json: { error: 'showcase-upload' } });
  expect(await call(router, 'GET', '/api/nowhere')).toMatchObject({ status: 404, json: { error: 'not-found' } });
});

test('validates a preset in the page: valid, invalid lines, too large', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage, base: '' });
  const yaml = readFileSync(join(repoRoot, 'presets', 'crash-push.yaml'), 'utf8');
  const valid = await call(router, 'POST', '/api/presets/validate', { yaml, modelId: 'wan22-i2v-a14b-fun-camera' });
  expect(valid).toMatchObject({ status: 200, json: { ok: true, preset: { id: 'crash-push', name: 'Crash Push', poses: ['zoom_in'], speed: 1.5 } } });
  const invalid = await call(router, 'POST', '/api/presets/validate', { yaml: yaml.replace('speed: 1.5', 'speed: 99') });
  expect(invalid.status).toBe(422);
  expect(invalid.json).toMatchObject({ error: 'invalid-preset', problems: [expect.stringMatching(/^camera\.speed: /)] });
  const huge = await call(router, 'POST', '/api/presets/validate', { yaml: `${yaml}#${'x'.repeat(17 * 1024)}` });
  expect(huge).toMatchObject({ status: 413, json: { error: 'preset-too-large' } });
  expect((await call(router, 'POST', '/api/presets/validate', {})).status).toBe(400);
});

test('a sequence goes running, assembling, succeeded with blob URLs', async () => {
  const fake = controllableMontage();
  const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
  const created = await call(router, 'POST', '/api/sequences', film);
  expect(created.status).toBe(201);
  expect(created.json).toMatchObject({ state: 'running', shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] });
  const id = created.json.id as string;
  await flush();
  expect((await call(router, 'GET', `/api/sequences/${id}`)).json).toMatchObject({ state: 'assembling', stage: 'loading-ffmpeg' });
  fake.stage('joining');
  expect((await call(router, 'GET', `/api/sequences/${id}`)).json).toMatchObject({ state: 'assembling', stage: 'joining' });
  expect(fake.jobs[0]).toMatchObject({
    clips: ['/showcase/clips/crash-push--landscape-a.mp4', '/showcase/clips/pan-left--landscape-a.mp4'],
    verticals: ['/showcase/clips/crash-push--landscape-a.9x16.mp4', '/showcase/clips/pan-left--landscape-a.9x16.mp4'],
  });
  fake.finish();
  await flush();
  const done = (await call(router, 'GET', `/api/sequences/${id}`)).json;
  expect(done).toMatchObject({ state: 'succeeded', progress: 1 });
  expect(done.outputUrl).toMatch(/^blob:/);
  expect(done.verticalUrl).toMatch(/^blob:/);
});

test('a film with any placeholder shot is tagged as a placeholder', async () => {
  const fake = controllableMontage();
  const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
  await call(router, 'POST', '/api/sequences', film);
  expect(fake.jobs[0]!.tags).toEqual(PLACEHOLDER_METADATA);
  fake.finish();
  await flush();
  const rendered = showcaseData();
  rendered.clips = rendered.clips.map((clip) => ({ ...clip, placeholder: false }));
  const second = controllableMontage();
  await call(createShowcaseRouter(rendered, { montage: second.montage, base: '' }), 'POST', '/api/sequences', film);
  expect(second.jobs[0]!.tags).toEqual(AI_METADATA);
});

test('a montage that cannot load FFmpeg ends the sequence as ffmpeg-unavailable', async () => {
  const fake = controllableMontage();
  const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
  const id = (await call(router, 'POST', '/api/sequences', film)).json.id as string;
  fake.fail('ffmpeg-unavailable');
  await flush();
  expect((await call(router, 'GET', `/api/sequences/${id}`)).json).toMatchObject({ state: 'failed', error: 'ffmpeg-unavailable' });
  // The montage is free again: another film may start.
  expect((await call(router, 'POST', '/api/sequences', film)).status).toBe(201);
});

test('a second film while one is assembling answers 409 montage-busy', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage, base: '' });
  expect((await call(router, 'POST', '/api/sequences', film)).status).toBe(201);
  expect(await call(router, 'POST', '/api/sequences', film)).toMatchObject({ status: 409, json: { error: 'montage-busy' } });
  expect(await call(router, 'POST', '/api/sequences', { ...film, shots: [{ presetId: 'crash-push' }] })).toMatchObject({
    status: 400,
    json: { error: 'invalid-shots' },
  });
});

test('cancel aborts the montage and ends canceled', async () => {
  const fake = controllableMontage();
  const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
  const id = (await call(router, 'POST', '/api/sequences', film)).json.id as string;
  await flush();
  const canceled = await call(router, 'POST', `/api/sequences/${id}/cancel`);
  expect(canceled.json).toMatchObject({ state: 'canceled' });
  expect(fake.signal()!.aborted).toBe(true);
  await flush();
  expect((await call(router, 'GET', `/api/sequences/${id}`)).json).toMatchObject({ state: 'canceled' });
  expect((await call(router, 'POST', '/api/sequences', film)).status).toBe(201);
});

test('a new film revokes the blob URLs of the previous one', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  try {
    const fake = controllableMontage();
    const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
    const first = (await call(router, 'POST', '/api/sequences', film)).json.id as string;
    fake.finish();
    await flush();
    const firstFilm = (await call(router, 'GET', `/api/sequences/${first}`)).json;
    expect(revoke).not.toHaveBeenCalled();
    await call(router, 'POST', '/api/sequences', film);
    fake.finish();
    await flush();
    expect(revoke).toHaveBeenCalledWith(firstFilm.outputUrl);
    expect(revoke).toHaveBeenCalledWith(firstFilm.verticalUrl);
  } finally {
    revoke.mockRestore();
  }
});

test('preload starts loading FFmpeg', async () => {
  const fake = controllableMontage();
  const router = createShowcaseRouter(showcaseData(), { montage: fake.montage, base: '' });
  expect((await router('/api/showcase/preload', { method: 'POST' })).status).toBe(204);
  expect(fake.montage.preload).toHaveBeenCalledTimes(1);
});

test('an unreadable data.json answers 503 and is retried', async () => {
  let attempts = 0;
  const showcaseFetch = createShowcaseFetch(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('HTTP 404');
      return showcaseData();
    },
    async () => controllableMontage().montage,
  );
  const first = await showcaseFetch('/api/presets');
  expect(first.status).toBe(503);
  expect(await first.json()).toEqual({ error: 'showcase-unavailable' });
  const second = await showcaseFetch('/api/presets');
  expect(second.status).toBe(200);
  expect(attempts).toBe(2);
});

test('the showcase shows no extension before the GPU session', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage });
  const { status, json } = await call(router, 'GET', '/api/extensions');
  expect(status).toBe(200);
  expect(json).toEqual({ extensions: [], effects: [], hooks: [], estimates: { t2i: 12 } });
});

test('the showcase creates no image from a text: 403 showcase-t2i', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage });
  const { status, json } = await call(router, 'POST', '/api/images', { prompt: 'a fox', aspect: '16:9' });
  expect(status).toBe(403);
  expect(json).toEqual({ error: 'showcase-t2i' });
});

test('an extension without examples answers like the server hides it: 404 extension-disabled', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage });
  for (const path of ['/api/edits', '/api/effects', '/api/hooks', '/api/avatars']) {
    const { status, json } = await call(router, 'POST', path, {});
    expect([path, status, json]).toEqual([path, 404, { error: 'extension-disabled' }]);
  }
});

test('the showcase history holds the clips of this visit only, newest first', async () => {
  const router = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage });
  expect((await call(router, 'GET', '/api/history')).json).toEqual([]);
  await call(router, 'POST', '/api/generations', { presetId: 'crash-push', imageRef: 'samples/landscape-a' });
  await call(router, 'POST', '/api/generations', { presetId: 'pan-left', imageRef: 'samples/landscape-a' });
  const { status, json } = await call(router, 'GET', '/api/history');
  expect(status).toBe(200);
  const items = json as unknown as { kind: string; name: string; reprise: Record<string, unknown> }[];
  expect(items.map((item) => item.name)).toEqual(['Pan Left', 'Crash Push']);
  expect(items[0]).toMatchObject({ kind: 'clip', reprise: { tab: 'camera', imageRef: 'samples/landscape-a', presetId: 'pan-left' } });
  // Another visit (a new page) starts empty.
  const next = createShowcaseRouter(showcaseData(), { montage: controllableMontage().montage });
  expect((await call(next, 'GET', '/api/history')).json).toEqual([]);
});

/** The showcase after the GPU session: Squish and two hooks rendered on the sample. */
function withExamples(): ShowcaseData {
  const data = showcaseData();
  const example = (kind: 'effect' | 'hook', id: string) => ({
    sample: 'landscape-a',
    url: `${kind === 'effect' ? 'effects' : 'hooks'}/${id}--landscape-a.mp4`,
    workflowUrl: `workflows/${kind}-${id}--landscape-a.json`,
  });
  const effects = { modelId: 'wan21-i2v-effects', modelName: 'Wan 2.1 I2V (effects)', license: 'Apache-2.0' };
  const transitions = { modelId: 'wan22-flf2v-transition', modelName: 'Wan 2.2 FLF2V', license: 'Apache-2.0' };
  data.effects = [{ id: 'squish', name: 'Squish', description: 'squished', ...effects, examples: [example('effect', 'squish')] }];
  data.hooks = [
    { id: 'iris-dive', name: 'Iris Dive', description: 'into the eye', ...transitions, references: 1, examples: [example('hook', 'iris-dive')] },
    // A two-photo hook needs an outfit the showcase cannot take: it stays off.
    { id: 'wardrobe-swap', name: 'Wardrobe Swap', description: 'new clothes', ...transitions, references: 2, examples: [example('hook', 'wardrobe-swap')] },
  ];
  return data;
}

test('the showcase shows the effects that have an example, with their samples', async () => {
  const router = createShowcaseRouter(withExamples(), { montage: controllableMontage().montage });
  const info = (await call(router, 'GET', '/api/extensions')).json as unknown as ExtensionsInfo;
  expect(info.extensions).toEqual(['effects', 'transitions']);
  expect(info.effects).toEqual([
    expect.objectContaining({ id: 'squish', name: 'Squish', samples: ['landscape-a'], modelName: 'Wan 2.1 I2V (effects)', license: 'Apache-2.0', previewUrl: expect.stringMatching(/effects\/squish--landscape-a\.mp4$/) }),
  ]);
  expect(info.hooks.map((hook) => hook.id)).toEqual(['iris-dive']);
});

test('an effect with an example answers a finished job, kept for the visit history', async () => {
  const router = createShowcaseRouter(withExamples(), { montage: controllableMontage().montage, newId: () => 'job-1' });
  const created = await call(router, 'POST', '/api/effects', { imageRef: 'samples/landscape-a', effectId: 'squish' });
  expect(created.status).toBe(201);
  expect(created.json).toMatchObject({ id: 'job-1', task: 'effect', state: 'succeeded', label: { itemId: 'squish', name: 'Squish' }, outputUrl: expect.stringMatching(/effects\/squish--landscape-a\.mp4$/) });
  expect((await call(router, 'GET', '/api/jobs/job-1')).json).toEqual(created.json);
  const hook = await call(router, 'POST', '/api/hooks', { imageRef: 'samples/landscape-a', hookId: 'iris-dive' });
  expect(hook.json).toMatchObject({ task: 'hook', outputUrl: expect.stringMatching(/hooks\/iris-dive--landscape-a\.mp4$/) });
  const history = (await call(router, 'GET', '/api/history')).json as unknown as HistoryItem[];
  expect(history.map((item) => [item.task, item.reprise])).toEqual([
    ['hook', { tab: 'effects', imageRef: 'samples/landscape-a', personal: false, hookId: 'iris-dive' }],
    ['effect', { tab: 'effects', imageRef: 'samples/landscape-a', personal: false, effectId: 'squish' }],
  ]);
});

test('an effect without an example for this photo: 404 not-in-showcase', async () => {
  const router = createShowcaseRouter(withExamples(), { montage: controllableMontage().montage });
  for (const [path, body] of [
    ['/api/effects', { imageRef: 'samples/landscape-a', effectId: 'explode' }],
    ['/api/hooks', { imageRef: 'samples/landscape-a', hookId: 'wardrobe-swap' }],
    ['/api/effects', { imageRef: 'samples/elsewhere', effectId: 'squish' }],
  ] as const) {
    expect((await call(router, 'POST', path, body)).json).toEqual({ error: 'not-in-showcase' });
  }
  // The info lists the sample texts that Text to image offers.
  const showcase = (await call(router, 'GET', '/api/showcase')).json as { samples: { prompt?: string }[] };
  expect(showcase.samples[0]).not.toHaveProperty('prompt');
});

test("the showcase wall follows the Studio's order, Squish first, whatever the file order", async () => {
  const data = withExamples();
  // prepare writes the library's order: file names, Cake-ify before Squish.
  const cakeify = { ...data.effects[0]!, id: 'cakeify', name: 'Cake-ify', examples: data.effects[0]!.examples.map((e) => ({ ...e, url: 'effects/cakeify--landscape-a.mp4' })) };
  const figurine = { ...data.hooks[0]!, id: 'figurine', name: 'Figurine' };
  data.effects = [cakeify, ...data.effects];
  data.hooks = [figurine, ...data.hooks];
  const router = createShowcaseRouter(data, { montage: controllableMontage().montage });
  const info = (await call(router, 'GET', '/api/extensions')).json as unknown as ExtensionsInfo;
  expect(info.effects.map((effect) => effect.id)).toEqual(['squish', 'cakeify']);
  expect(info.hooks.map((hook) => hook.id)).toEqual(['iris-dive', 'figurine']);
});
