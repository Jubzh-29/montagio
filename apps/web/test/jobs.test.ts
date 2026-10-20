import { existsSync } from 'node:fs';
import { BackendError } from '@montagio/comfy-adapter';
import { CompileError } from '@montagio/presets';
import { readImageTags, readTags } from '@montagio/sequence';
import { GET as getJobRoute } from '@/app/api/jobs/[id]/route';
import { POST as cancelJobRoute } from '@/app/api/jobs/[id]/cancel/route';
import { GET as getWorkflow } from '@/app/api/workflows/[id]/route';
import { JobError } from '@/server/errors';
import { resetRejectedForTests, visibleExtensions } from '@/server/extensions';
import { mediaFileFor } from '@/server/generations';
import { createJobEngine, jobFailureResponse, type CompiledStep, type JobRecord, type TaskDef } from '@/server/jobs';
import { getServices, resetServicesForTests } from '@/server/services';
import { readUploadMeta } from '@/server/uploads';
import { params, setupTempData } from './helpers';

setupTempData();
beforeEach(() => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  resetRejectedForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MONTAGIO_EXTENSIONS;
});

const step = (kind: 'image' | 'video' | 'audio', node: string, extra: Partial<CompiledStep> = {}): CompiledStep => ({
  workflow: { [node]: { class_type: kind === 'image' ? 'SaveImage' : kind === 'audio' ? 'SaveAudio' : 'SaveVideo', inputs: {} } },
  output: { kind, node },
  files: [],
  ...extra,
});

const imageTask: TaskDef = {
  prepare: async () => ({ inputs: { prompt: 'a fox' }, label: { name: 'Test image' }, modelId: 'z-image-turbo', seed: 7 }),
  steps: () => [{ name: 'make', presetId: 'text-to-image', extension: null, compile: async () => step('image', '9') }],
  imageOrigin: async () => ({ origin: 't2i', personal: false }),
};

const engine = (tasks: Parameters<typeof createJobEngine>[0] = { t2i: imageTask }) => createJobEngine(tasks);

/** Poll until the job ends (the demo backend renders in 0 ms here). */
async function settle(jobs: ReturnType<typeof engine>, id: string): Promise<JobRecord> {
  for (let i = 0; i < 20; i++) {
    const record = (await jobs.get(id))!;
    if (['succeeded', 'failed', 'canceled'].includes(record.state)) return record;
  }
  throw new Error(`job ${id} did not settle`);
}

test('a one-step image job ends with a tagged PNG registered as an upload', async () => {
  const jobs = engine();
  const { record, created } = await jobs.create('t2i', {}, 'k-image');
  expect(created).toBe(true);
  const done = await settle(jobs, record.id);
  expect(done.state).toBe('succeeded');
  expect(done.outputImageRef).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
  expect(done.personal).toBe(false);
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 't2i', personal: false });
  const file = mediaFileFor(done.outputUrl)!;
  expect(await readImageTags(file)).toMatchObject({ Comment: 'AI-generated' });
});

test('a one-step audio job ends with a tagged FLAC', async () => {
  const jobs = engine({
    music: {
      prepare: async () => ({ inputs: {}, label: {}, modelId: 'ace-step15-music', seed: 1 }),
      steps: () => [{ name: 'music', presetId: 'music', extension: 'music', compile: async () => step('audio', '107') }],
    },
  });
  const done = await settle(jobs, (await jobs.create('music', {}, 'k-audio')).record.id);
  expect(done.outputUrl).toMatch(/\.flac$/);
  const tags = await readTags(mediaFileFor(done.outputUrl)!);
  expect(Object.entries(tags).find(([key]) => key.toLowerCase() === 'comment')?.[1]).toBe('AI-generated');
}, 30_000);

test('a two-step job compiles the second step from the first output, and ends on a tagged clip', async () => {
  const seen: (string | undefined)[] = [];
  const jobs = engine({
    hook: {
      prepare: async () => ({ inputs: {}, label: { itemId: 'iris-dive', name: 'Iris Dive' }, modelId: 'wan22-flf2v-transition', seed: 3, aspect: '16:9' }),
      steps: () => [
        { name: 'edit', presetId: 'iris-dive', extension: 'edit', compile: async () => step('image', '9') },
        {
          name: 'transition',
          presetId: 'iris-dive',
          extension: 'transitions',
          compile: async (record) => {
            seen.push(record.steps[0]!.outputPath);
            return step('video', '61');
          },
        },
      ],
    },
  });
  const done = await settle(jobs, (await jobs.create('hook', {}, 'k-hook')).record.id);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/_default\.png$/);
  expect(done.state).toBe('succeeded');
  expect(done.steps.map((s) => s.state)).toEqual(['succeeded', 'succeeded']);
  expect(done.steps[0]!.outputUrl).toMatch(/^\/media\/data\/jobs\/.+\/step0\.png$/);
  expect(done.outputUrl).toMatch(/^\/media\/data\/jobs\/.+\/output\.mp4$/);
  expect(done.frames).toBeGreaterThan(0);
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  // FFmpeg tags and probes the clip: on a loaded machine that passes the 5 s default.
}, 30_000);

test('after a restart, an image step is polled as an image', async () => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '60000';
  const jobs = engine();
  const { record } = await jobs.create('t2i', {}, 'k-restart');
  resetServicesForTests();
  const get = vi.spyOn(getServices().backend, 'get');
  await jobs.get(record.id);
  expect(get).toHaveBeenCalledWith(record.steps[0]!.backendJobId, { output: 'image', outputNode: '9' });
});

test('the same key twice, even at once, creates one job', async () => {
  const jobs = engine();
  const [a, b] = await Promise.all([jobs.create('t2i', {}, 'k-twice'), jobs.create('t2i', {}, 'k-twice')]);
  expect(a.record.id).toBe(b.record.id);
  expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  const again = await jobs.create('t2i', {}, 'k-twice');
  expect(again).toMatchObject({ created: false, record: { id: a.record.id } });
});

test('a key reused after the window starts a new job', async () => {
  const jobs = engine();
  const first = await jobs.create('t2i', {}, 'k-window');
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
  const second = await jobs.create('t2i', {}, 'k-window');
  expect(second.created).toBe(true);
  expect(second.record.id).not.toBe(first.record.id);
});

test('cancel stops the running step and keeps the job canceled', async () => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '60000';
  const jobs = engine();
  const { record } = await jobs.create('t2i', {}, 'k-cancel');
  expect((await jobs.cancel(record.id))?.state).toBe('canceled');
  expect((await jobs.get(record.id))?.state).toBe('canceled');
});

test('a workflow ComfyUI rejects marks its extension rejected', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'all';
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(getServices().backend, 'submit').mockRejectedValue(new BackendError('workflow-rejected', false, 'missing node'));
  const jobs = engine({
    edit: {
      prepare: async () => ({ inputs: {}, label: {}, modelId: 'qwen-image-edit-2511', seed: 1 }),
      steps: () => [{ name: 'edit', presetId: 'edit', extension: 'edit', compile: async () => step('image', '9') }],
    },
  });
  const error = await jobs.create('edit', {}, 'k-rejected').catch((e: unknown) => e);
  expect(jobFailureResponse(error)?.status).toBe(422);
  expect(await visibleExtensions()).not.toContain('edit');
  expect(warn).toHaveBeenCalled();
});

test('a CompileError becomes invalid-input and its message stays in the log', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const jobs = engine({
    t2i: { ...imageTask, steps: () => [{ name: 'make', presetId: 'text-to-image', extension: null, compile: async () => { throw new CompileError('C:/pod/secret path'); } }] },
  });
  const error = await jobs.create('t2i', {}, 'k-compile').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(JobError);
  const response = jobFailureResponse(error)!;
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toBe(JSON.stringify({ error: 'invalid-input' }));
  expect(log.mock.calls.flat().join(' ')).toContain('secret path');
});

test('GET /api/jobs/:id answers 404 for an unknown or unsafe id', async () => {
  expect((await getJobRoute(new Request('http://localhost/x'), params({ id: 'nope' }))).status).toBe(404);
  expect((await getJobRoute(new Request('http://localhost/x'), params({ id: '../x' }))).status).toBe(404);
  expect((await cancelJobRoute(new Request('http://localhost/x', { method: 'POST' }), params({ id: 'nope' }))).status).toBe(404);
});

test('GET /api/workflows/:id serves the last step workflow of a job', async () => {
  const jobs = engine({
    t2i: { ...imageTask, steps: () => [{ name: 'make', presetId: 'text-to-image', extension: null, compile: async () => step('image', '9', { workflow: { '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'marker' } } } }) }] },
  });
  const { record } = await jobs.create('t2i', {}, 'k-workflow');
  const res = await getWorkflow(new Request('http://localhost/x'), params({ id: record.id }));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-disposition')).toContain(`montagio-t2i-${record.id}.json`);
  expect(await res.json()).toEqual({ '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'marker' } } });
  expect(existsSync(mediaFileFor(`/media/data/jobs/${record.id}/step0.workflow.json`)!)).toBe(true);
});
