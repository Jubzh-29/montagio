import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendError, ComfyBackend, IDEMPOTENCY_WINDOW_MS, isBackendError, type SubmitJob } from '../src/index';
import { startFakeProxy, type FakeJobState, type FakeProxy } from '../src/testing/fake-proxy';

const sample = fileURLToPath(new URL('../../../demo-assets/images/sample-16x9.png', import.meta.url));
// A real clip (the fixtures under test/fixtures/clips are empty placeholders): byte checks must mean something.
const clip = fileURLToPath(new URL('../../../demo-assets/clips/_default.mp4', import.meta.url));

let fake: FakeProxy;
let outputsDir: string;
const saved = { key: process.env.COMFY_API_KEY, base: process.env.COMFY_BASE_URL };

beforeEach(async () => {
  fake = await startFakeProxy();
  outputsDir = mkdtempSync(join(tmpdir(), 'montagio-outputs-'));
});

afterEach(async () => {
  await fake.close();
  rmSync(outputsDir, { recursive: true, force: true });
  for (const [name, value] of [['COMFY_API_KEY', saved.key], ['COMFY_BASE_URL', saved.base]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const job = (files = [{ node: '1', field: 'image', path: sample }]): SubmitJob => ({
  workflow: {
    '1': { class_type: 'LoadImage', inputs: { image: 'uploads/x.png' } },
    '2': { class_type: 'SaveVideo', inputs: { video: ['1', 0] } },
  },
  presetId: 'crash-push',
  idempotencyKey: randomUUID(),
  files,
});

const backend = () => new ComfyBackend({ baseUrl: fake.url, outputsDir });

/** An output of the fake proxy whose content is served from `bytes`. */
function output(name: string, type: string, contentType: string, bytes: Buffer = readFileSync(clip)): FakeJobState['outputs'][number] {
  const assetId = `out-${randomUUID()}`;
  fake.assets.set(assetId, { bytes, contentType, filePath: name });
  return { node_id: '2', name, type, content_type: contentType, assetId };
}

const contentRequests = () => fake.requests.filter((r) => r.method === 'GET' && r.path.endsWith('/content')).length;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('submit uploads the image and binds it as an asset, with no credential', async () => {
  process.env.COMFY_API_KEY = 'cloud-secret';
  process.env.COMFY_BASE_URL = 'http://127.0.0.1:1';
  const b = backend();
  const { backendJobId } = await b.submit(job());
  const sent = fake.jobs.get(backendJobId)!.workflow;
  expect(sent['1']!.inputs.image).toMatchObject({ __type: 'core/ASSET' });
  expect(sent['2']!.inputs.video).toEqual(['1', 0]);
  expect([...fake.assets.values()][0]!.bytes.equals(readFileSync(sample))).toBe(true);
  expect(fake.requests.length).toBeGreaterThan(0);
  expect(fake.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
  expect(process.env.COMFY_API_KEY).toBe('cloud-secret');
  expect(process.env.COMFY_BASE_URL).toBe('http://127.0.0.1:1');
});

test('the workflow given to submit is not modified', async () => {
  const submitted = job();
  await backend().submit(submitted);
  expect(submitted.workflow['1']!.inputs.image).toBe('uploads/x.png');
});

test('queued and running progress is reported, bounded to 0..1', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  expect(await b.get(id)).toEqual({ id, state: 'queued', progress: 0 });
  fake.setJob(id, { status: 'running', progress: { value: 0.42, nodes_done: 3, nodes_total: 7 } });
  expect(await b.get(id)).toEqual({ id, state: 'running', progress: 0.42 });
  fake.setJob(id, { progress: { value: 3, nodes_done: 7, nodes_total: 7 } });
  expect(await b.get(id)).toMatchObject({ state: 'running', progress: 1 });
});

test('a succeeded job downloads its video once', async () => {
  expect(readFileSync(clip).length).toBeGreaterThan(1000);
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'succeeded', outputs: [output('Montagio_00001.mp4', 'video', 'video/mp4')] });
  const done = await b.get(id);
  expect(done).toEqual({ id, state: 'succeeded', progress: 1, outputPath: join(outputsDir, `${id}.mp4`) });
  expect(readFileSync(done.outputPath!).equals(readFileSync(clip))).toBe(true);
  expect(await b.get(id)).toEqual(done);
  expect(await backend().get(id)).toEqual(done); // a restarted app reuses the file
  expect(contentRequests()).toBe(1);
  expect(readdirSync(outputsDir)).toEqual([`${id}.mp4`]);
});

test('a clip removed from disk is downloaded again on the next get', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'succeeded', outputs: [output('Montagio_00001.mp4', 'video', 'video/mp4')] });
  const done = await b.get(id);
  rmSync(done.outputPath!);
  expect(await b.get(id)).toEqual(done);
  expect(readFileSync(done.outputPath!).equals(readFileSync(clip))).toBe(true);
  expect(contentRequests()).toBe(2);
});

test('a clip download that stalls hits its deadline, leaves no partial file, and is retried on the next get', async () => {
  const b = new ComfyBackend({ baseUrl: fake.url, outputsDir, downloadTimeoutMs: 300 });
  const { backendJobId: id } = await b.submit(job());
  const video = output('Montagio_00001.mp4', 'video', 'video/mp4');
  fake.assets.get(video.assetId)!.stall = true;
  fake.setJob(id, { status: 'succeeded', outputs: [video] });
  const t0 = Date.now();
  const error = await b.get(id).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BackendError);
  expect(error).toMatchObject({ code: 'backend-unavailable', retryable: true });
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(readdirSync(outputsDir)).toEqual([]);
  fake.assets.get(video.assetId)!.stall = false;
  expect(await b.get(id)).toEqual({ id, state: 'succeeded', progress: 1, outputPath: join(outputsDir, `${id}.mp4`) });
});

test('the video output is preferred over an image preview', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, {
    status: 'succeeded',
    outputs: [output('preview.png', 'image', 'image/png', Buffer.from('png')), output('Montagio_00001.mp4', 'video', 'video/mp4')],
  });
  const done = await b.get(id);
  expect(done.outputPath).toBe(join(outputsDir, `${id}.mp4`));
  expect(readFileSync(done.outputPath!).equals(readFileSync(clip))).toBe(true);
});

test('without a video-typed output, a video/* file is the video', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, {
    status: 'succeeded',
    outputs: [output('preview.png', 'image', 'image/png', Buffer.from('png')), output('Montagio_00001.webm', 'file', 'video/webm')],
  });
  expect((await b.get(id)).outputPath).toBe(join(outputsDir, `${id}.webm`));
});

test('succeeded without a video output is failed/no-output', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'succeeded', outputs: [output('preview.png', 'image', 'image/png', Buffer.from('png'))] });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'no-output' });
  expect(readdirSync(outputsDir)).toEqual([]);
});

test('a failed job exposes a stable code, never the message', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'failed', error: { code: 'execution_error', message: 'Traceback /root/ComfyUI/execution.py' } });
  const failed = await b.get(id);
  expect(failed).toMatchObject({ state: 'failed', error: 'execution_error' });
  expect(JSON.stringify(failed)).not.toContain('Traceback');
  fake.setJob(id, { error: { code: 'a b/c', message: 'x' } });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'failed' });
  fake.setJob(id, { error: null });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'failed' });
});

test('an expired job is failed/expired', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'expired' });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'expired' });
});

test('an unknown job is lost', async () => {
  expect(await backend().get('job-that-never-was')).toMatchObject({ state: 'failed', error: 'lost' });
});

test('a malformed job id is lost without a request', async () => {
  expect(await backend().get('../../x')).toMatchObject({ state: 'failed', error: 'lost' });
  expect(await backend().get('http://elsewhere/x')).toMatchObject({ state: 'failed', error: 'lost' });
  expect(fake.requests).toEqual([]);
});

test('cancel, and canceling counts as canceled', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  await b.cancel(id);
  expect(fake.jobs.get(id)!.status).toBe('canceled');
  expect(await b.get(id)).toMatchObject({ state: 'canceled' });
  fake.setJob(id, { status: 'canceling' });
  expect(await b.get(id)).toMatchObject({ state: 'canceled' });
  await expect(b.cancel('job-that-never-was')).resolves.toBeUndefined();
});

test('same idempotency key, one job', async () => {
  const b = backend();
  const same = job();
  const [first, second] = await Promise.all([b.submit(same), b.submit(same)]);
  expect(second.backendJobId).toBe(first.backendJobId);
  expect(await b.submit(same)).toEqual(first);
  expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/api/v2/jobs')).toHaveLength(1);
});

test('a key reused after the idempotency window is a new job, as in the web layer', async () => {
  let now = 1_000_000;
  const b = new ComfyBackend({ baseUrl: fake.url, outputsDir, now: () => now });
  const same = job();
  const first = await b.submit(same);
  now += IDEMPOTENCY_WINDOW_MS - 1;
  expect(await b.submit(same)).toEqual(first);
  now += 1;
  const second = await b.submit(same);
  expect(second.backendJobId).not.toBe(first.backendJobId);
  expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/api/v2/jobs')).toHaveLength(2);
});

test('a rejected workflow is a non-retryable workflow-rejected', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    fake.rejectNextSubmit(422, 'invalid_workflow');
    const error = await backend().submit(job()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ code: 'workflow-rejected', retryable: false });
    expect(logged).toHaveBeenCalled();
  } finally {
    logged.mockRestore();
  }
});

test('a failed submit can be retried with the same key', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const b = backend();
    const same = job();
    fake.rejectNextSubmit(422, 'invalid_workflow');
    await expect(b.submit(same)).rejects.toBeInstanceOf(BackendError);
    const { backendJobId } = await b.submit(same);
    expect(fake.jobs.has(backendJobId)).toBe(true);
  } finally {
    logged.mockRestore();
  }
});

test('an unreachable proxy is a retryable backend-unavailable', async () => {
  const b = new ComfyBackend({ baseUrl: `http://127.0.0.1:${await freePort()}`, outputsDir });
  for (const attempt of [() => b.submit(job()), () => b.get('job-1')]) {
    const error = await attempt().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ code: 'backend-unavailable', retryable: true });
  }
});

test('a new backend instance finds a running job by id (app restart)', async () => {
  const { backendJobId: id } = await backend().submit(job());
  fake.setJob(id, { status: 'running', progress: { value: 0.3, nodes_done: 2, nodes_total: 7 } });
  expect(await backend().get(id)).toEqual({ id, state: 'running', progress: 0.3 });
});

test('a job id with path characters is refused at submit', async () => {
  for (const bad of ['..%2F..%2Fx', '..', '/api/v2/jobs/x']) {
    fake.nextJobId(bad);
    const error = await backend().submit(job()).catch((e: unknown) => e);
    expect(error, bad).toBeInstanceOf(BackendError);
    expect(error, bad).toMatchObject({ code: 'backend-error', retryable: false });
  }
});

test('an output name cannot leave outputsDir', async () => {
  // Nested in a temporary root, so a regression writes there and not next to the system temp folder.
  const root = mkdtempSync(join(tmpdir(), 'montagio-escape-'));
  try {
    const nested = join(root, 'a', 'b', 'outputs');
    const b = new ComfyBackend({ baseUrl: fake.url, outputsDir: nested });
    const { backendJobId: id } = await b.submit(job());
    fake.setJob(id, { status: 'succeeded', outputs: [output('../../evil.sh', 'video', 'video/mp4')] });
    expect((await b.get(id)).outputPath).toBe(join(nested, `${id}.bin`));
    expect(readdirSync(nested)).toEqual([`${id}.bin`]);
    expect(existsSync(resolve(nested, '../../evil.sh'))).toBe(false);
    expect(readdirSync(join(root, 'a'))).toEqual(['b']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a cancel link to another origin is refused', async () => {
  const other = await startFakeProxy();
  try {
    const b = backend();
    const { backendJobId: id } = await b.submit(job());
    fake.setJob(id, { cancelUrl: `${other.url}/api/v2/jobs/${id}/cancel` });
    await expect(b.cancel(id)).rejects.toThrow();
    expect(other.requests).toEqual([]);
    expect(fake.jobs.get(id)!.status).toBe('queued');
  } finally {
    await other.close();
  }
});

test('the fake proxy runs a job to a clip on its own (autoRun)', async () => {
  await fake.close();
  fake = await startFakeProxy({ autoRun: { clip } });
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  const states: string[] = [];
  for (let i = 0; i < 5 && states.at(-1) !== 'succeeded'; i++) states.push((await b.get(id)).state);
  expect(states).toEqual(['running', 'succeeded']);
  expect(readFileSync(join(outputsDir, `${id}.mp4`)).equals(readFileSync(clip))).toBe(true);
});

test('a redirect to another origin is refused before any request goes there', async () => {
  const other = await startFakeProxy();
  try {
    fake.redirectNext(307, other.url);
    const error = await backend().submit(job()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'backend-unavailable' });
    expect(other.requests).toEqual([]);
  } finally {
    await other.close();
  }
});

test('a redirect within the proxy origin is followed, body included', async () => {
  fake.redirectNext(307, fake.url, '/api/v2/jobs');
  const { backendJobId } = await backend().submit(job());
  expect(fake.jobs.get(backendJobId)!.workflow['2']!.class_type).toBe('SaveVideo');
  expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/api/v2/jobs')).toHaveLength(2);
});

test('a succeeded job whose video is gone from the proxy is failed/no-output', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, {
    status: 'succeeded',
    outputs: [{ node_id: '2', name: 'Montagio_00001.mp4', type: 'video', content_type: 'video/mp4', assetId: 'gone' }],
  });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'no-output' });
  expect(readdirSync(outputsDir)).toEqual([]);
});

test('a status outside the contract is failed/unexpected-status, not polled forever', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(job());
  fake.setJob(id, { status: 'paused' });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'unexpected-status' });
});

test('a BackendError is recognised across copies of the adapter (separate route bundles)', () => {
  const foreign = Object.assign(new Error('x'), {
    name: 'BackendError',
    code: 'workflow-rejected',
    retryable: false,
    [Symbol.for('montagio.BackendError')]: true,
  });
  expect(isBackendError(foreign)).toBe(true);
  expect(isBackendError(new BackendError('backend-error', false))).toBe(true);
  expect(isBackendError(new Error('backend-error'))).toBe(false);
  expect(isBackendError({ code: 'workflow-rejected' })).toBe(false);
});

// Jobs whose output is not a video: the music, voice and image-edit workflows.

/** An output of `node`, served from `bytes`. */
function outputOf(node: string, name: string, type: string, contentType: string, bytes: Buffer): FakeJobState['outputs'][number] {
  const assetId = `out-${randomUUID()}`;
  fake.assets.set(assetId, { bytes, contentType, filePath: name });
  return { node_id: node, name, type, content_type: contentType, assetId };
}

const outputJob = (output: SubmitJob['output'], outputNode?: string): SubmitJob => ({
  workflow: { '107': { class_type: 'SaveAudioAdvanced', inputs: { filename_prefix: 'montagio/music', format: 'flac' } } },
  presetId: 'extension',
  idempotencyKey: randomUUID(),
  output,
  ...(outputNode ? { outputNode } : {}),
});

test('an audio job downloads its FLAC output, whatever its content type', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('audio', '107'));
  const flac = Buffer.from('fLaC fake stream');
  fake.setJob(id, { status: 'succeeded', outputs: [outputOf('107', 'music_00001.flac', 'audio', 'application/octet-stream', flac)] });
  const done = await b.get(id);
  expect(done).toEqual({ id, state: 'succeeded', progress: 1, outputPath: join(outputsDir, `${id}.flac`) });
  expect(readFileSync(done.outputPath!).equals(flac)).toBe(true);
});

test('an image job downloads its PNG output', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('image'));
  const png = Buffer.from('png bytes');
  fake.setJob(id, { status: 'succeeded', outputs: [outputOf('9', 'edit_00001_.png', 'image', 'image/png', png)] });
  const done = await b.get(id);
  expect(done.outputPath).toBe(join(outputsDir, `${id}.png`));
  expect(readFileSync(done.outputPath!).equals(png)).toBe(true);
});

test('the output of outputNode wins over another output of the same type', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('image', '9'));
  const preview = Buffer.from('preview');
  const edit = Buffer.from('the edited photo');
  fake.setJob(id, {
    status: 'succeeded',
    outputs: [outputOf('5', 'preview_00001_.png', 'image', 'image/png', preview), outputOf('9', 'edit_00001_.png', 'image', 'image/png', edit)],
  });
  expect(readFileSync((await b.get(id)).outputPath!).equals(edit)).toBe(true);
});

test('an audio job without an audio output fails with no-output', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('audio'));
  fake.setJob(id, { status: 'succeeded', outputs: [output('Montagio_00001.mp4', 'video', 'video/mp4')] });
  expect(await b.get(id)).toMatchObject({ state: 'failed', error: 'no-output' });
  expect(readdirSync(outputsDir)).toEqual([]);
});

test('after a restart, get with the job output kind delivers the audio', async () => {
  const { backendJobId: id } = await backend().submit(outputJob('audio', '107'));
  fake.setJob(id, { status: 'succeeded', outputs: [outputOf('107', 'music_00001.flac', 'audio', 'application/octet-stream', Buffer.from('fLaC'))] });
  expect((await backend().get(id, { output: 'audio', outputNode: '107' })).outputPath).toBe(join(outputsDir, `${id}.flac`));
});

test('after a restart without a hint, a job is read as a video job, as before', async () => {
  const { backendJobId: id } = await backend().submit(outputJob('audio'));
  fake.setJob(id, { status: 'succeeded', outputs: [outputOf('107', 'music_00001.flac', 'audio', 'application/octet-stream', Buffer.from('fLaC'))] });
  expect(await backend().get(id)).toMatchObject({ state: 'failed', error: 'no-output' });
});

test('an output with an unknown audio extension is saved as .bin', async () => {
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('audio'));
  fake.setJob(id, { status: 'succeeded', outputs: [outputOf('107', 'music_00001.xyz', 'audio', 'audio/x-unknown', Buffer.from('?'))] });
  expect((await b.get(id)).outputPath).toBe(join(outputsDir, `${id}.bin`));
});

test('the fake proxy gives a SaveAudioAdvanced workflow an audio output (autoRun)', async () => {
  await fake.close();
  fake = await startFakeProxy({ autoRun: { clip } });
  const b = backend();
  const { backendJobId: id } = await b.submit(outputJob('audio', '107'));
  for (let i = 0; i < 3; i++) await b.get(id);
  const job = fake.jobs.get(id)!;
  expect(job.outputs).toEqual([expect.objectContaining({ node_id: '107', type: 'audio', content_type: 'application/octet-stream' })]);
  expect(job.outputs[0]!.name).toMatch(/\.flac$/);
  expect(readdirSync(outputsDir)).toEqual([`${id}.flac`]);
});

test('the fake proxy gives a SaveImage workflow an image output (autoRun)', async () => {
  await fake.close();
  fake = await startFakeProxy({ autoRun: { clip } });
  const b = backend();
  const submitted: SubmitJob = {
    workflow: { '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'montagio/edit' } } },
    presetId: 'edit',
    idempotencyKey: randomUUID(),
    output: 'image',
  };
  const { backendJobId: id } = await b.submit(submitted);
  for (let i = 0; i < 3; i++) await b.get(id);
  expect(fake.jobs.get(id)!.outputs).toEqual([expect.objectContaining({ node_id: '9', type: 'image', content_type: 'image/png' })]);
  expect(readdirSync(outputsDir)).toEqual([`${id}.png`]);
});
