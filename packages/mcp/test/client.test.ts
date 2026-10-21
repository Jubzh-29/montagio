import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MontagioClient } from '../src/client';
import { DEFAULT_URL, readConfig } from '../src/config';
import { ToolFailure } from '../src/errors';
import { BASE_URL, fakeClock, fakeFetch, reply, testConfig } from './fake-app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montagio-mcp-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const uploaded = { imageRef: 'uploads/abc.png', width: 1280, height: 720, aspect: '16:9', origin: 'upload', personal: true };

describe('readConfig', () => {
  it('defaults to the local app and URLs only', () => {
    const config = readConfig({});
    expect(config.baseUrl).toBe(DEFAULT_URL);
    expect(config.outDir).toBeUndefined();
    expect(config.timeoutMs).toBe(30 * 60_000);
    expect(config.pollIntervalMs).toBe(2000);
  });

  it('reads MONTAGIO_URL and MONTAGIO_MCP_OUT', () => {
    const config = readConfig({ MONTAGIO_URL: 'http://192.168.1.20:3100/', MONTAGIO_MCP_OUT: dir });
    expect(config.baseUrl).toBe('http://192.168.1.20:3100');
    expect(config.outDir).toBe(dir);
  });

  it('refuses a MONTAGIO_URL that is not an http URL', () => {
    expect(() => readConfig({ MONTAGIO_URL: 'not a url' })).toThrow(/MONTAGIO_URL/);
    expect(() => readConfig({ MONTAGIO_URL: 'file:///etc' })).toThrow(/MONTAGIO_URL/);
  });
});

describe('MontagioClient', () => {
  it('uploads a local photo as the multipart field "image", typed by its extension', async () => {
    const photo = join(dir, 'me.JPG');
    await writeFile(photo, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const app = fakeFetch(() => reply(uploaded));
    const result = await new MontagioClient(testConfig(), { fetch: app.fetch }).uploadPhoto(photo);

    expect(result).toEqual(uploaded);
    expect(app.calls).toHaveLength(1);
    const [call] = app.calls;
    expect(call).toMatchObject({ method: 'POST', url: `${BASE_URL}/api/uploads` });
    const file = call!.form!.get('image') as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('me.JPG');
    expect(file.size).toBe(4);
  });

  it('refuses a file of another kind, or a missing one, before sending anything', async () => {
    const app = fakeFetch(() => reply(uploaded));
    const client = new MontagioClient(testConfig(), { fetch: app.fetch });
    const text = join(dir, 'notes.txt');
    await writeFile(text, 'hello');
    await expect(client.uploadPhoto(text)).rejects.toMatchObject({ code: 'unsupported-file' });
    await expect(client.uploadPhoto(join(dir, 'missing.png'))).rejects.toMatchObject({ code: 'file-not-found' });
    await expect(client.uploadVideo(join(dir, 'missing.mp4'))).rejects.toMatchObject({ code: 'file-not-found' });
    expect(app.calls).toHaveLength(0);
  });

  it('sends a fresh Idempotency-Key with every job POST', async () => {
    const app = fakeFetch((call) => reply({ id: `job-${call.headers['idempotency-key']}`, task: 't2i', state: 'queued', progress: 0, label: {}, modelId: 'z-image-turbo' }, 201));
    const client = new MontagioClient(testConfig(), { fetch: app.fetch });
    await client.startJob('/api/images', { prompt: 'a lighthouse at dawn', aspect: '16:9' });
    await client.startJob('/api/images', { prompt: 'a lighthouse at dawn', aspect: '16:9' });

    const keys = app.calls.map((call) => call.headers['idempotency-key']);
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toMatch(UUID);
    expect(keys[0]).not.toBe(keys[1]);
    expect(app.calls[0]!.headers['content-type']).toBe('application/json');
    expect(app.calls[0]!.json).toEqual({ prompt: 'a lighthouse at dawn', aspect: '16:9' });
  });

  it('polls a job every 2 s from queued through running to succeeded', async () => {
    const states = [
      { state: 'running', progress: 0.4 },
      { state: 'running', progress: 0.8 },
      { state: 'succeeded', progress: 1, outputUrl: '/media/data/jobs/j1/output.mp4', frames: 81 },
    ];
    const app = fakeFetch((call) => {
      if (call.method === 'POST') return reply({ id: 'j1', task: 'effect', state: 'queued', progress: 0, label: { itemId: 'squish' }, modelId: 'wan21' }, 201);
      return reply({ id: 'j1', task: 'effect', label: { itemId: 'squish' }, modelId: 'wan21', ...states.shift() });
    });
    const clock = fakeClock();
    const client = new MontagioClient(testConfig(), { fetch: app.fetch, ...clock });
    const seen: string[] = [];
    const done = await client.wait(await client.startJob('/api/effects', { imageRef: 'samples/x.png', effectId: 'squish' }), {
      onProgress: (status) => seen.push(`${status.state} ${status.progress}`),
    });

    expect(done).toMatchObject({ kind: 'job', id: 'j1', state: 'succeeded', outputUrl: `${BASE_URL}/media/data/jobs/j1/output.mp4`, frames: 81 });
    expect(seen).toEqual(['queued 0', 'running 0.4', 'running 0.8', 'succeeded 1']);
    expect(app.calls.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual(['/api/jobs/j1', '/api/jobs/j1', '/api/jobs/j1']);
    expect(clock.sleeps).toEqual([2000, 2000, 2000]);
  });

  it('keeps polling through a short outage, then gives up after four failures in a row', async () => {
    let gets = 0;
    const app = fakeFetch(() => {
      gets++;
      if (gets === 1) throw new TypeError('fetch failed');
      if (gets === 2) return new Response('busy', { status: 503 });
      return reply({ id: 'j2', task: 't2i', state: 'succeeded', progress: 1, outputUrl: '/media/data/uploads/p.png' });
    });
    const client = new MontagioClient(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const done = await client.wait({ kind: 'job', id: 'j2', task: 't2i', state: 'queued', progress: 0 });
    expect(done.state).toBe('succeeded');

    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const offline = new MontagioClient(testConfig(), { fetch: down.fetch, ...fakeClock() });
    await expect(offline.wait({ kind: 'job', id: 'j3', task: 't2i', state: 'running', progress: 0.2 })).rejects.toMatchObject({
      code: 'app-unreachable',
      details: { id: 'j3' },
    });
    expect(down.calls).toHaveLength(4);
  });

  it('stops waiting at the timeout, with the id to follow the render', async () => {
    const app = fakeFetch(() => reply({ id: 'g1', presetId: 'crash-push', modelId: 'wan22', state: 'running', progress: 0.5 }));
    const client = new MontagioClient(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const failure = await client
      .wait({ kind: 'generation', id: 'g1', task: 'camera', state: 'queued', progress: 0 }, { timeoutMs: 10_000 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect(failure).toMatchObject({ code: 'timeout', details: { kind: 'generation', id: 'g1', state: 'running' } });
    expect(app.calls.every((call) => call.path === '/api/generations/g1')).toBe(true);
    expect(app.calls).toHaveLength(5);
  });

  it('maps a refusal to its code, and an upload sentence to its HTTP status', async () => {
    const app = fakeFetch((call) =>
      call.path === '/api/edits' ? reply({ error: 'consent-required' }, 400) : reply({ error: 'images are limited to 10 MB' }, 413),
    );
    const client = new MontagioClient(testConfig(), { fetch: app.fetch });
    await expect(client.startJob('/api/edits', { imageRef: 'uploads/a.png', instruction: 'red jacket' })).rejects.toMatchObject({
      code: 'consent-required',
      details: { status: 400 },
    });
    const photo = join(dir, 'big.png');
    await writeFile(photo, new Uint8Array(8));
    await expect(client.uploadPhoto(photo)).rejects.toMatchObject({ code: 'http-413', message: 'images are limited to 10 MB' });
  });

  it('finds a camera clip by id when no job has it', async () => {
    const app = fakeFetch((call) =>
      call.path.startsWith('/api/jobs/')
        ? reply({ error: 'not-found' }, 404)
        : reply({ id: 'g2', presetId: 'slow-push', modelId: 'wan22', state: 'succeeded', progress: 1, outputUrl: '/media/data/generations/g2/clip.mp4' }),
    );
    const status = await new MontagioClient(testConfig(), { fetch: app.fetch }).find('g2');
    expect(status).toMatchObject({ kind: 'generation', task: 'camera', presetId: 'slow-push', outputUrl: `${BASE_URL}/media/data/generations/g2/clip.mp4` });
  });

  it('downloads a finished file into MONTAGIO_MCP_OUT, from this app only', async () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
    const app = fakeFetch(() => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }));
    const out = join(dir, 'out');
    const client = new MontagioClient(testConfig({ outDir: out }), { fetch: app.fetch });
    const file = await client.download({ kind: 'job', id: 'j1', task: 'effect', state: 'succeeded', progress: 1, outputUrl: `${BASE_URL}/media/data/jobs/j1/output.mp4` });

    expect(file).toBe(join(out, 'montagio-effect-j1.mp4'));
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
    await expect(
      client.download({ kind: 'job', id: 'j1', task: 'effect', state: 'succeeded', progress: 1, outputUrl: 'http://elsewhere.test/x.mp4' }),
    ).rejects.toMatchObject({ code: 'download-failed' });
    expect(app.calls).toHaveLength(1);
  });
});
