import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TOOL_NAMES } from '../src/tools';
import { BASE_URL, callTool, connect, fakeClock, fakeFetch, reply, testConfig, type Call } from './fake-app';

const EXTENSIONS = {
  extensions: ['edit', 'effects', 'transitions', 'upscale'],
  effects: [{ id: 'squish', name: 'Squish', description: 'Squeezed like a toy', estimate_s: 140, subjectMax: 120, modelName: 'Wan 2.1 I2V 480p', license: 'Apache-2.0' }],
  hooks: [{ id: 'wardrobe-swap', name: 'Wardrobe Swap', description: 'A new outfit', estimate_s: 200, references: 2, modelName: 'Wan 2.2 FLF2V', license: 'Apache-2.0' }],
  estimates: { t2i: 12, edit: 30, upscale: 90 },
};

let dir: string;
let client: Client | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montagio-mcp-tools-'));
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** A fake app whose job routes start `j1`, then answer each poll with the next state. */
function jobApp(task: string, polls: Record<string, unknown>[], post?: (call: Call) => Response | undefined) {
  return fakeFetch((call) => {
    if (call.path === '/api/extensions') return reply(EXTENSIONS);
    if (call.method === 'POST' && call.path.startsWith('/api/')) {
      const answer = post?.(call);
      if (answer) return answer;
      return reply({ id: 'j1', task, state: 'queued', progress: 0, label: {}, modelId: 'model', createdAt: '2026-10-21T10:00:00.000Z' }, 201);
    }
    if (call.path === '/api/jobs/j1') return reply({ id: 'j1', task, label: {}, modelId: 'model', ...polls.shift() });
    if (call.path.startsWith('/media/')) return new Response(new Uint8Array([1, 2, 3, 4]));
    return reply({ error: 'not-found' }, 404);
  });
}

describe('MCP tools', () => {
  it('registers every tool, with a description and an input schema', async () => {
    client = await connect(testConfig(), { fetch: fakeFetch(() => reply({})).fetch });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'apply_effect',
        'apply_hook',
        'camera_move',
        'edit_photo',
        'get_job',
        'get_workflow',
        'list_camera_presets',
        'list_effects_and_hooks',
        'list_history',
        'motion_transfer',
        'talking_avatar',
        'text_to_image',
        'upload_photo',
        'upscale_to_1080p',
        'use_sample_photo',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
    }
    const effect = tools.find((tool) => tool.name === 'apply_effect')!;
    expect(effect.inputSchema.properties?.consent).toMatchObject({ type: 'boolean', default: false });
    const camera = tools.find((tool) => tool.name === 'camera_move')!;
    expect(JSON.stringify(camera.inputSchema.properties?.description)).toMatch(/Strongly recommended/);
  });

  it('text_to_image follows the job from queued through running to succeeded', async () => {
    const app = jobApp('t2i', [
      { state: 'queued', progress: 0 },
      { state: 'running', progress: 0.5 },
      { state: 'succeeded', progress: 1, outputUrl: '/media/data/uploads/t2i.png', outputImageRef: 'uploads/t2i.png', personal: false },
    ]);
    const clock = fakeClock();
    client = await connect(testConfig(), { fetch: app.fetch, ...clock });
    const { isError, data } = await callTool(client, 'text_to_image', { prompt: 'a lighthouse at dawn' });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      kind: 'job',
      id: 'j1',
      state: 'succeeded',
      outputUrl: `${BASE_URL}/media/data/uploads/t2i.png`,
      outputImageRef: 'uploads/t2i.png',
      estimate_s: 12,
    });
    expect(data.file).toBeUndefined();
    const post = app.calls.find((call) => call.method === 'POST')!;
    expect(post.path).toBe('/api/images');
    expect(post.json).toEqual({ prompt: 'a lighthouse at dawn', aspect: '16:9' });
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(app.calls.filter((call) => call.path === '/api/jobs/j1')).toHaveLength(3);
    expect(clock.sleeps).toEqual([2000, 2000, 2000]);
  });

  it('apply_effect sends consent: false unless the caller says otherwise', async () => {
    const app = jobApp('effect', [{ state: 'succeeded', progress: 1, outputUrl: '/media/data/jobs/j1/output.mp4' }]);
    client = await connect(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const { isError } = await callTool(client, 'apply_effect', { imageRef: 'samples/sample-16x9.png', effectId: 'squish', subject: 'a brown dog' });

    expect(isError).toBe(false);
    const post = app.calls.find((call) => call.path === '/api/effects')!;
    expect(post.json).toEqual({ imageRef: 'samples/sample-16x9.png', effectId: 'squish', subject: 'a brown dog', consent: false });
  });

  it('passes the app\'s consent refusal through as isError, with the photo already uploaded', async () => {
    const photo = join(dir, 'friend.png');
    await writeFile(photo, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const app = jobApp('edit', [], (call) => {
      if (call.path === '/api/uploads') return reply({ imageRef: 'uploads/friend.png', width: 512, height: 512, aspect: '1:1', origin: 'upload', personal: true });
      if (call.path === '/api/edits') return reply({ error: 'consent-required' }, 400);
      return undefined;
    });
    client = await connect(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const { isError, data } = await callTool(client, 'edit_photo', { path: photo, instruction: 'make the jacket red' });

    expect(isError).toBe(true);
    expect(data).toMatchObject({ error: 'consent-required', status: 400, inputImageRef: 'uploads/friend.png' });
    expect(String(data.message)).toMatch(/consent: true/);
    expect(app.calls.find((call) => call.path === '/api/edits')!.json).toMatchObject({ consent: false });
    // The refusal names nothing of the file: no bytes are echoed.
    expect(JSON.stringify(data)).not.toMatch(/PNG|\\u0089/);
  });

  it('turns a failed render into isError with its code and message', async () => {
    const app = jobApp('avatar', [{ state: 'failed', progress: 0.3, error: 'speech-too-long' }]);
    client = await connect(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const { isError, data } = await callTool(client, 'talking_avatar', { imageRef: 'samples/s.png', text: 'Hello there', consent: true });

    expect(isError).toBe(true);
    expect(data).toMatchObject({ error: 'speech-too-long', id: 'j1', state: 'failed' });
    expect(String(data.message)).toMatch(/15 s/);
    expect(app.calls.find((call) => call.path === '/api/avatars')!.json).toEqual({ imageRef: 'samples/s.png', text: 'Hello there', language: 'en', consent: true });
  });

  it('motion_transfer sends nothing without rights: true', async () => {
    const app = fakeFetch(() => reply({}));
    client = await connect(testConfig(), { fetch: app.fetch });
    const { isError, data } = await callTool(client, 'motion_transfer', { imageRef: 'samples/s.png', videoRef: 'videos/v1' });

    expect(isError).toBe(true);
    expect(data.error).toBe('rights-required');
    expect(app.calls).toHaveLength(0);
  });

  it('camera_move sends the description as userPrompt and polls the generation', async () => {
    const polls = [
      { state: 'running', progress: 0.5 },
      { state: 'succeeded', progress: 1, outputUrl: '/media/data/generations/g1/clip.mp4', frames: 81 },
    ];
    const app = fakeFetch((call) => {
      if (call.path === '/api/presets') return reply([{ id: 'crash-push', name: 'Crash Push', description: 'Fast push', poses: [], speed: 1, defaultModel: 'wan22-fun-camera' }]);
      if (call.path === '/api/models') return reply([{ id: 'wan22-fun-camera', name: 'Wan 2.2 Fun Camera', kind: 'video', tier: 'quality', license: 'Apache-2.0', estimate_s: { '480p': 420 } }]);
      if (call.path === '/api/generations') return reply({ id: 'g1', presetId: 'crash-push', modelId: 'wan22-fun-camera', state: 'queued', progress: 0 }, 201);
      return reply({ id: 'g1', presetId: 'crash-push', modelId: 'wan22-fun-camera', ...polls.shift() });
    });
    client = await connect(testConfig(), { fetch: app.fetch, ...fakeClock() });
    const { isError, data } = await callTool(client, 'camera_move', {
      imageRef: 'samples/sample-16x9.png',
      presetId: 'crash-push',
      description: 'a red vintage car on a wet street at night',
    });

    expect(isError).toBe(false);
    expect(data).toMatchObject({ kind: 'generation', id: 'g1', task: 'camera', outputUrl: `${BASE_URL}/media/data/generations/g1/clip.mp4`, estimate_s: 420 });
    expect(data.note).toBeUndefined();
    const post = app.calls.find((call) => call.path === '/api/generations')!;
    expect(post.json).toEqual({ presetId: 'crash-push', imageRef: 'samples/sample-16x9.png', userPrompt: 'a red vintage car on a wet street at night' });
    expect(post.headers['idempotency-key']).toBeTruthy();
    expect(app.calls.filter((call) => call.path === '/api/generations/g1')).toHaveLength(2);
  });

  it('downloads the finished file into MONTAGIO_MCP_OUT', async () => {
    const out = join(dir, 'renders');
    const app = jobApp('effect', [{ state: 'succeeded', progress: 1, outputUrl: '/media/data/jobs/j1/output.mp4' }]);
    client = await connect(testConfig({ outDir: out }), { fetch: app.fetch, ...fakeClock() });
    const { isError, data } = await callTool(client, 'apply_effect', { imageRef: 'samples/s.png', effectId: 'squish' });

    expect(isError).toBe(false);
    expect(data.file).toBe(join(out, 'montagio-effect-j1.mp4'));
    expect(new Uint8Array(await readFile(data.file as string))).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(app.calls.some((call) => call.url === `${BASE_URL}/media/data/jobs/j1/output.mp4`)).toBe(true);
  });

  it('says the app is unreachable instead of throwing', async () => {
    const app = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    client = await connect(testConfig(), { fetch: app.fetch });
    const { isError, data } = await callTool(client, 'use_sample_photo');
    expect(isError).toBe(true);
    expect(data.error).toBe('app-unreachable');
    expect(String(data.message)).toContain(BASE_URL);
  });

  it('get_workflow saves the ComfyUI JSON into the output folder, never over a file, never elsewhere', async () => {
    const workflow = { '3': { class_type: 'KSampler', inputs: {} } };
    const app = fakeFetch(() =>
      Response.json(workflow, { headers: { 'content-disposition': 'attachment; filename="../../montagio-crash-push-g1.json"' } }),
    );
    client = await connect({ ...testConfig(), outDir: dir }, { fetch: app.fetch });
    const first = await callTool(client, 'get_workflow', { id: 'g1', save: true });
    expect(first.isError).toBe(false);
    expect(first.data.path).toBe(join(await realpath(dir), 'montagio-crash-push-g1.json'));
    expect(JSON.parse(await readFile(first.data.path as string, 'utf8'))).toEqual(workflow);
    const second = await callTool(client, 'get_workflow', { id: 'g1', save: true });
    expect(second.data.path).toBe(join(await realpath(dir), 'montagio-crash-push-g1-1.json'));
    expect(app.calls[0]!.path).toBe('/api/workflows/g1');
  });

  it('get_workflow refuses to save without an output folder', async () => {
    const app = fakeFetch(() => Response.json({}, { headers: { 'content-disposition': 'attachment; filename="w.json"' } }));
    client = await connect(testConfig(), { fetch: app.fetch });
    const { isError, data } = await callTool(client, 'get_workflow', { id: 'g1', save: true });
    expect(isError).toBe(true);
    expect(data.error).toBe('no-output-folder');
  });
});
