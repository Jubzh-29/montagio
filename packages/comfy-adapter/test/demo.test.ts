import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend, DemoBackend, IDEMPOTENCY_WINDOW_MS } from '../src/index';
import { startFakeProxy } from '../src/testing/fake-proxy';

const fixtureClips = fileURLToPath(new URL('./fixtures/clips', import.meta.url));
let t = 0;
const clock = () => t;
const make = () => new DemoBackend({ clipsDir: fixtureClips, durationMs: 3000, now: clock });

beforeEach(() => {
  t = 0;
});

test('lifecycle with a fake clock', async () => {
  const b = make();
  const { backendJobId } = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'k1' });
  expect(await b.get(backendJobId)).toMatchObject({ state: 'running', progress: 0 });
  t = 1500;
  expect(await b.get(backendJobId)).toMatchObject({ state: 'running', progress: 0.5 });
  t = 3000;
  const done = await b.get(backendJobId);
  expect(done.state).toBe('succeeded');
  expect(done.progress).toBe(1);
  expect(done.outputPath).toMatch(/[\\/]crash-push\.mp4$/);
});

test('falls back to _default.mp4', async () => {
  const b = make();
  const { backendJobId } = await b.submit({ workflow: {}, presetId: 'unknown-preset', idempotencyKey: 'k2' });
  t = 5000;
  expect((await b.get(backendJobId)).outputPath).toMatch(/[\\/]_default\.mp4$/);
});

test('same idempotency key, same job', async () => {
  const b = make();
  const a = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'same' });
  t = 1000;
  const c = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'same' });
  expect(c.backendJobId).toBe(a.backendJobId);
  expect(a.backendJobId).toMatch(/^demo-[0-9a-f]{12}$/);
  expect((await b.get(a.backendJobId)).progress).toBeCloseTo(1 / 3);
});

test('a key reused after the idempotency window is a new job, as in the web layer', async () => {
  const b = make();
  const first = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'again' });
  t = IDEMPOTENCY_WINDOW_MS - 1;
  expect(await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'again' })).toEqual(first);
  t = IDEMPOTENCY_WINDOW_MS;
  const second = await b.submit({ workflow: {}, presetId: 'unknown-preset', idempotencyKey: 'again' });
  expect(second.backendJobId).not.toBe(first.backendJobId);
  expect(await b.get(second.backendJobId)).toMatchObject({ state: 'running', progress: 0 });
  expect((await b.get(first.backendJobId)).outputPath).toMatch(/[\\/]crash-push\.mp4$/);
});

describe('render: the file made from the job\'s photo', () => {
  const files = [{ node: '1', field: 'image', path: '/data/uploads/photo.png' }];

  test('replaces the pre-rendered clip, and the job waits for it at 99 %', async () => {
    let finish: (path: string) => void = () => undefined;
    const render = vi.fn(() => new Promise<string | undefined>((resolve) => (finish = resolve)));
    const b = new DemoBackend({ clipsDir: fixtureClips, durationMs: 3000, now: clock, render });
    const { backendJobId } = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'r1', files });
    expect(render).toHaveBeenCalledWith({ presetId: 'crash-push', output: 'video', files });
    t = 5000;
    expect(await b.get(backendJobId)).toMatchObject({ state: 'running', progress: 0.99 });
    finish('/data/demo-renders/moved.mp4');
    await Promise.resolve();
    expect(await b.get(backendJobId)).toMatchObject({ state: 'succeeded', progress: 1, outputPath: '/data/demo-renders/moved.mp4' });
  });

  test('a render that gives nothing, or fails, leaves the pre-rendered clip', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const empty = new DemoBackend({ clipsDir: fixtureClips, durationMs: 3000, now: clock, render: async () => undefined });
    const failing = new DemoBackend({ clipsDir: fixtureClips, durationMs: 3000, now: clock, render: () => Promise.reject(new Error('no ffmpeg')) });
    const a = await empty.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'r2', files });
    const c = await failing.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'r3', files });
    await new Promise((resolve) => setTimeout(resolve, 0));
    t = 5000;
    expect((await empty.get(a.backendJobId)).outputPath).toMatch(/[\\/]crash-push\.mp4$/);
    expect((await failing.get(c.backendJobId)).outputPath).toMatch(/[\\/]crash-push\.mp4$/);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('is not asked for a job without files, nor for another output of the job', async () => {
    const render = vi.fn(async () => '/data/demo-renders/moved.mp4');
    const b = new DemoBackend({ clipsDir: fixtureClips, durationMs: 3000, now: clock, render });
    const plain = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'r4' });
    const voiced = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'r5', files });
    await Promise.resolve();
    t = 5000;
    expect(render).toHaveBeenCalledOnce();
    expect((await b.get(plain.backendJobId)).outputPath).toMatch(/[\\/]crash-push\.mp4$/);
    expect((await b.get(voiced.backendJobId, { output: 'audio' })).outputPath).toMatch(/[\\/]_default\.flac$/);
  });
});

test('different keys, different jobs', async () => {
  const b = make();
  const a = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'one' });
  const c = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'two' });
  expect(c.backendJobId).not.toBe(a.backendJobId);
});

test('cancel stops a running job', async () => {
  const b = make();
  const { backendJobId } = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'k3' });
  t = 1000;
  await b.cancel(backendJobId);
  t = 5000;
  expect((await b.get(backendJobId)).state).toBe('canceled');
});

test('cancel after completion keeps the result', async () => {
  const b = make();
  const { backendJobId } = await b.submit({ workflow: {}, presetId: 'crash-push', idempotencyKey: 'k4' });
  t = 4000;
  await b.cancel(backendJobId);
  expect((await b.get(backendJobId)).state).toBe('succeeded');
});

test('unknown job is lost', async () => {
  expect(await make().get('demo-000000000000')).toMatchObject({ state: 'failed', error: 'lost' });
});

test('factory builds the demo backend by default', () => {
  expect(createBackend({ MONTAGIO_DEMO_CLIPS: fixtureClips }).kind).toBe('demo');
});

test('local needs an explicit COMFY_BASE_URL', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'local' })).toThrow(/COMFY_BASE_URL/);
  expect(() => createBackend({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: '  ' })).toThrow(/COMFY_BASE_URL/);
});

test('local refuses a Comfy-hosted URL', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: 'https://cloud.comfy.org' })).toThrow(/refused/);
});

test('local builds the Comfy backend', () => {
  expect(createBackend({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: 'http://127.0.0.1:8189' }).kind).toBe('local');
});

test('local keeps its clips under <MONTAGIO_DATA>/comfy-outputs, else under <MONTAGIO_ROOT>/data/comfy-outputs', async () => {
  const fake = await startFakeProxy();
  const tmp = mkdtempSync(join(tmpdir(), 'montagio-factory-'));
  try {
    fake.assets.set('clip', { bytes: Buffer.from('clip'), contentType: 'video/mp4', filePath: 'Montagio_00001.mp4' });
    const outputPath = async (env: Record<string, string>) => {
      const b = createBackend({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: fake.url, ...env });
      const workflow = { '2': { class_type: 'SaveVideo', inputs: {} } };
      const { backendJobId: id } = await b.submit({ workflow, presetId: 'p', idempotencyKey: randomUUID() });
      const outputs = [{ node_id: '2', name: 'Montagio_00001.mp4', type: 'video', content_type: 'video/mp4', assetId: 'clip' }];
      fake.setJob(id, { status: 'succeeded', outputs });
      return [id, (await b.get(id)).outputPath];
    };
    const [a, inData] = await outputPath({ MONTAGIO_DATA: join(tmp, 'data-dir'), MONTAGIO_ROOT: join(tmp, 'root') });
    expect(inData).toBe(join(tmp, 'data-dir', 'comfy-outputs', `${a}.mp4`));
    const [b, inRoot] = await outputPath({ MONTAGIO_ROOT: join(tmp, 'root') });
    expect(inRoot).toBe(join(tmp, 'root', 'data', 'comfy-outputs', `${b}.mp4`));
  } finally {
    await fake.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('hosted is not available yet', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'hosted' })).toThrow(/not available yet/);
});

test('factory refuses an unknown backend', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'closed-api' })).toThrow(/unknown backend/i);
});

describe('outputs by kind', () => {
  const finished = async (b: DemoBackend, job: Parameters<DemoBackend['submit']>[0], want?: Parameters<DemoBackend['get']>[1]) => {
    const { backendJobId } = await b.submit(job);
    t = 5000;
    return b.get(backendJobId, want);
  };

  test('an image job delivers the default PNG', async () => {
    const done = await finished(make(), { workflow: {}, presetId: 'text-to-image', idempotencyKey: 'img', output: 'image' });
    expect(done.state).toBe('succeeded');
    expect(done.outputPath).toMatch(/[\\/]images[\\/]_default\.png$/);
  });

  test('an audio job delivers the default FLAC', async () => {
    const done = await finished(make(), { workflow: {}, presetId: 'music', idempotencyKey: 'aud', output: 'audio' });
    expect(done.outputPath).toMatch(/[\\/]audio[\\/]_default\.flac$/);
  });

  test('want overrides the kind given at submit', async () => {
    const done = await finished(make(), { workflow: {}, presetId: 'crash-push', idempotencyKey: 'w' }, { output: 'image' });
    expect(done.outputPath).toMatch(/[\\/]images[\\/]_default\.png$/);
  });

  test('a job without an output kind is still a video job', async () => {
    const done = await finished(make(), { workflow: {}, presetId: 'crash-push', idempotencyKey: 'v' });
    expect(done.outputPath).toMatch(/[\\/]clips[\\/]crash-push\.mp4$/);
  });

  test('a job forgotten by a restart is lost, whatever kind get() asks for', async () => {
    const { backendJobId } = await make().submit({ workflow: {}, presetId: 'text-to-image', idempotencyKey: 'r', output: 'image' });
    expect(await make().get(backendJobId, { output: 'image' })).toMatchObject({ state: 'failed', error: 'lost' });
  });

  test('createBackend reads MONTAGIO_DEMO_IMAGES and MONTAGIO_DEMO_AUDIO', async () => {
    const images = mkdtempSync(join(tmpdir(), 'montagio-demo-images-'));
    const audio = mkdtempSync(join(tmpdir(), 'montagio-demo-audio-'));
    try {
      const b = createBackend({ MONTAGIO_BACKEND: 'demo', MONTAGIO_DEMO_DURATION_MS: '0', MONTAGIO_DEMO_IMAGES: images, MONTAGIO_DEMO_AUDIO: audio });
      const img = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'ci', output: 'image' });
      const snd = await b.submit({ workflow: {}, presetId: 'p', idempotencyKey: 'ca', output: 'audio' });
      expect((await b.get(img.backendJobId)).outputPath).toBe(join(images, '_default.png'));
      expect((await b.get(snd.backendJobId)).outputPath).toBe(join(audio, '_default.flac'));
    } finally {
      rmSync(images, { recursive: true, force: true });
      rmSync(audio, { recursive: true, force: true });
    }
  });
});

test('a job that makes a file gets the demo words, beside the clips', async () => {
  const b = make();
  const { backendJobId } = await b.submit({ workflow: {}, presetId: 'captions', idempotencyKey: 'words', output: 'file' });
  t = 3000;
  expect((await b.get(backendJobId)).outputPath).toMatch(/[\\/]captions[\\/]_default\.json$/);
});
