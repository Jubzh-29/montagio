import { fileURLToPath } from 'node:url';
import { createBackend, DemoBackend } from '../src/index';

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

test('factory refuses local until plan 2', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'local' })).toThrow(/plan 2/);
});

test('factory refuses an unknown backend', () => {
  expect(() => createBackend({ MONTAGIO_BACKEND: 'closed-api' })).toThrow(/unknown backend/i);
});
