import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend, DemoBackend } from '../src/index';
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
