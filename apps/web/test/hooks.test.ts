import { basename } from 'node:path';
import { BackendError } from '@montagio/comfy-adapter';
import { readTags } from '@montagio/sequence';
import { POST as postHooks } from '@/app/api/hooks/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { jobs, readJobWorkflow } from '@/server/jobs';
import { getServices } from '@/server/services';
import { params, pngFile, setupTempData, uploadRequest } from './helpers';

setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  vi.restoreAllMocks();
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const post = (body: unknown, key: string) =>
  postHooks(
    new Request('http://localhost/api/hooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
  );

const pollOnce = async (id: string) => (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = await pollOnce(id);
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('hook did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const importedRef = async () => ((await (await postUpload(uploadRequest(pngFile(1280, 720)))).json()) as { imageRef: string }).imageRef;

test('Iris Dive on a sample photo: the end frame shows after the edit, then a tagged clip', async () => {
  const res = await post({ imageRef: await sampleRef(), hookId: 'iris-dive' }, 'hk1');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'hook', label: { itemId: 'iris-dive', name: 'Iris Dive' } });
  const first = await pollOnce(created.id);
  expect(first.state).toBe('running');
  expect(first.stepImageUrl).toMatch(/\/step0\.png$/);
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect(done.outputUrl).toMatch(/\/output\.mp4$/);
  expect(done.frames).toBeGreaterThan(0);
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  // FFmpeg tags and probes the clip: on a loaded machine that passes the 5 s default.
}, 30_000);

test('the transition is compiled from the photo and the edit output', async () => {
  const { id } = (await (await post({ imageRef: await sampleRef(), hookId: 'iris-dive' }, 'hk2')).json()) as JobSummary;
  await pollOnce(id);
  const record = (await jobs.read(id))!;
  const { workflow } = (await readJobWorkflow(id))!;
  const model = (await getServices().library).extensionModels.get('wan22-flf2v-transition')!;
  const end = model.bindings.end_image;
  const target = Array.isArray(end) ? end[0]! : end!;
  expect(workflow[target.node]!.inputs[target.field]).toBe(basename(record.steps[0]!.outputPath!));
});

test('Wardrobe Swap without a second photo: 400 invalid-input', async () => {
  const res = await post({ imageRef: await sampleRef(), hookId: 'wardrobe-swap' }, 'hk3');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid-input' });
});

test('a personal second photo asks for consent, even on a sample first photo', async () => {
  const body = { imageRef: await sampleRef(), image2Ref: await importedRef(), hookId: 'wardrobe-swap' };
  const res = await post(body, 'hk4');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'consent-required' });
  expect((await post({ ...body, consent: true }, 'hk4-consent')).status).toBe(201);
});

test('a hidden hook: 404 extension-disabled', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit,transitions';
  const res = await post({ imageRef: await sampleRef(), hookId: 'iris-dive' }, 'hk5');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('a second step that fails to start is submitted once on the next poll', async () => {
  const backend = getServices().backend;
  const submit = backend.submit.bind(backend);
  let refused = false;
  const spy = vi.spyOn(backend, 'submit').mockImplementation(async (job) => {
    if (job.idempotencyKey.endsWith('#step1') && !refused) {
      refused = true;
      throw new BackendError('backend-unavailable', true, 'proxy out of reach');
    }
    return submit(job);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { id } = (await (await post({ imageRef: await sampleRef(), hookId: 'iris-dive' }, 'hk6')).json()) as JobSummary;
  expect((await pollOnce(id)).state).toBe('running');
  await poll(id);
  const keys = spy.mock.calls.map(([job]) => job.idempotencyKey.replace(/^.*#/, ''));
  expect(keys).toEqual(['step0', 'step1', 'step1']);
}, 30_000);

test('a hook comes back on the effects tab with its hook id', async () => {
  const imageRef = await sampleRef();
  const { id } = (await (await post({ imageRef, hookId: 'iris-dive' }, 'hk7')).json()) as JobSummary;
  await poll(id);
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'hook', name: 'Iris Dive', reprise: { tab: 'effects', hookId: 'iris-dive', imageRef } });
}, 30_000);
