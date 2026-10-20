import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeProxy, type FakeProxy } from '@montagio/comfy-adapter/testing';
import { parseModel } from '@montagio/registry';
import { readTags } from '@montagio/sequence';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postSequence } from '@/app/api/sequences/route';
import { GET as getSequence } from '@/app/api/sequences/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { mediaFileFor } from '@/server/generations';
import { resetServicesForTests } from '@/server/services';
import { generationRequest, params, pngFile, repoRoot, setupTempData, uploadRequest } from './helpers';

// MONTAGIO_BACKEND=local against a fake comfy-api-proxy that renders the demo clip.
const dataDir = setupTempData();
const clip = join(repoRoot, 'demo-assets', 'clips', '_default.mp4');
let fake: FakeProxy;

beforeEach(async () => {
  fake = await startFakeProxy({ autoRun: { clip } });
  process.env.MONTAGIO_BACKEND = 'local';
  process.env.COMFY_BASE_URL = fake.url;
  resetServicesForTests();
});

afterEach(async () => {
  await fake.close();
  delete process.env.COMFY_BASE_URL;
});

async function uploadedImageRef(): Promise<string> {
  return ((await (await postUpload(uploadRequest(pngFile(1920, 1080)))).json()) as { imageRef: string }).imageRef;
}

const postGeneration = (body: unknown, key: string) => postGenerations(generationRequest(body, key));

function sequenceRequest(body: unknown, key: string): Request {
  return new Request('http://localhost/api/sequences', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

async function pollUntilDone(id: string, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const record = await (await getGeneration(new Request(`http://localhost/api/generations/${id}`), params({ id }))).json();
    if (['succeeded', 'failed', 'canceled'].includes(record.state)) return record;
    if (Date.now() > end) throw new Error(`generation stuck in ${record.state}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function pollSequence(id: string, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const record = await (await getSequence(new Request(`http://localhost/api/sequences/${id}`), params({ id }))).json();
    if (['succeeded', 'failed', 'canceled'].includes(record.state)) return record;
    if (Date.now() > end) throw new Error(`sequence stuck in ${record.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// bindings.image of wan22-i2v-a14b-fun-camera, the model of crash-push and pan-left
const imageBinding = parseModel(readFileSync(join(repoRoot, 'registry', 'models', 'wan22-i2v-a14b-fun-camera.yaml'), 'utf8'), 'fun-camera').bindings.image!;
const imageAssetOf = (workflow: Record<string, { inputs: Record<string, unknown> }>) =>
  workflow[imageBinding.node]!.inputs[imageBinding.field] as { __type: string; info: { id: string } };

test('a generation runs through the SDK and the proxy', async () => {
  const imageRef = await uploadedImageRef();
  const res = await postGeneration({ presetId: 'crash-push', imageRef }, 'l1');
  expect(res.status).toBe(201);
  const rec = await pollUntilDone((await res.json()).id);
  expect(rec).toMatchObject({ state: 'succeeded', backendKind: 'local', outputUrl: `/media/data/generations/${rec.id}/clip.mp4` });
  const sent = [...fake.jobs.values()][0]!.workflow;
  const asset = imageAssetOf(sent);
  expect(asset).toMatchObject({ __type: 'core/ASSET' });
  expect(fake.assets.get(asset.info.id)!.bytes.equals(readFileSync(join(dataDir(), imageRef)))).toBe(true);
  expect(await readTags(mediaFileFor(rec.outputUrl)!)).toMatchObject({ comment: 'AI-generated' });
}, 30_000);

test('a two-shot sequence uploads the last frame as the second image', async () => {
  const imageRef = await uploadedImageRef();
  const res = await postSequence(sequenceRequest({ imageRef, shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] }, 'l2'));
  expect(res.status).toBe(201);
  const done = await pollSequence((await res.json()).id);
  expect(done).toMatchObject({ state: 'succeeded', outputUrl: `/media/data/sequences/${done.id}/film.mp4` });
  expect(fake.jobs.size).toBe(2);
  const images = [...fake.jobs.values()].map((job) => imageAssetOf(job.workflow).info.id);
  expect(new Set(images).size).toBe(2);
  expect(fake.assets.get(images[1]!)!.bytes.equals(readFileSync(join(dataDir(), done.shots[1].startImageRef)))).toBe(true);
  expect(existsSync(join(dataDir(), 'sequences', done.id, 'film.mp4'))).toBe(true);
}, 90_000);

test('a workflow ComfyUI rejects answers 422 workflow-rejected', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const imageRef = await uploadedImageRef();
    fake.rejectNextSubmit(422, 'invalid_workflow');
    const res = await postGeneration({ presetId: 'crash-push', imageRef }, 'l3');
    expect([res.status, await res.json()]).toEqual([422, { error: 'workflow-rejected' }]);
  } finally {
    logged.mockRestore();
  }
});

test('a stopped proxy answers 503 backend-unavailable', async () => {
  const imageRef = await uploadedImageRef();
  await fake.close();
  const res = await postGeneration({ presetId: 'crash-push', imageRef }, 'l4');
  expect([res.status, await res.json()]).toEqual([503, { error: 'backend-unavailable' }]);
});

test('a proxy that answers an unusable job id answers 502 backend-error', async () => {
  const imageRef = await uploadedImageRef();
  fake.nextJobId('../../x');
  const res = await postGeneration({ presetId: 'crash-push', imageRef }, 'l5');
  expect([res.status, await res.json()]).toEqual([502, { error: 'backend-error' }]);
});

test('a sequence whose first shot is rejected answers 422', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const imageRef = await uploadedImageRef();
    fake.rejectNextSubmit(422, 'invalid_workflow');
    const res = await postSequence(sequenceRequest({ imageRef, shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] }, 'l6'));
    expect([res.status, await res.json()]).toEqual([422, { error: 'workflow-rejected' }]);
  } finally {
    logged.mockRestore();
  }
});

test('a later shot ComfyUI rejects fails the sequence with a stable code', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const imageRef = await uploadedImageRef();
    const res = await postSequence(sequenceRequest({ imageRef, shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] }, 'l7'));
    fake.rejectNextSubmit(422, 'invalid_workflow'); // the second shot's submit
    expect(await pollSequence((await res.json()).id)).toMatchObject({ state: 'failed', error: 'workflow-rejected' });
  } finally {
    logged.mockRestore();
  }
}, 60_000);

/** The proxy comes back on the same port with the jobs it had (a restart of the proxy process, not of the pod). */
async function restartProxy(down: FakeProxy): Promise<FakeProxy> {
  const back = await startFakeProxy({ port: Number(new URL(down.url).port), autoRun: { clip } });
  for (const [id, job] of down.jobs) back.jobs.set(id, job);
  for (const [id, asset] of down.assets) back.assets.set(id, asset);
  return back;
}

test('a proxy that drops while rendering keeps the generation alive, and it finishes once the proxy is back', async () => {
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGeneration({ presetId: 'crash-push', imageRef }, 'l8')).json();
    const down = fake;
    await down.close();
    const res = await getGeneration(new Request(`http://localhost/api/generations/${id}`), params({ id }));
    expect([res.status, (await res.json()).state]).toEqual([200, 'queued']);
    fake = await restartProxy(down);
    expect(await pollUntilDone(id)).toMatchObject({ state: 'succeeded', outputUrl: `/media/data/generations/${id}/clip.mp4` });
  } finally {
    warned.mockRestore();
  }
}, 30_000);

test('a proxy that drops while a sequence renders keeps the sequence running', async () => {
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const imageRef = await uploadedImageRef();
    const res = await postSequence(sequenceRequest({ imageRef, shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left' }] }, 'l9'));
    const { id } = await res.json();
    const down = fake;
    await down.close();
    const polled = await getSequence(new Request(`http://localhost/api/sequences/${id}`), params({ id }));
    expect([polled.status, (await polled.json()).state]).toEqual([200, 'running']);
    fake = await restartProxy(down);
    expect(await pollSequence(id)).toMatchObject({ state: 'succeeded' });
  } finally {
    warned.mockRestore();
  }
}, 90_000);

test('text to image against the fake proxy: the SaveImage output becomes the start photo', async () => {
  await fake.close();
  fake = await startFakeProxy({ autoRun: { clip, image: join(repoRoot, 'demo-assets', 'images', '_default.png') } });
  process.env.COMFY_BASE_URL = fake.url;
  resetServicesForTests();
  const { POST: postImages } = await import('@/app/api/images/route');
  const { GET: getJob } = await import('@/app/api/jobs/[id]/route');
  const res = await postImages(
    new Request('http://localhost/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'l-img' },
      body: JSON.stringify({ prompt: 'a lighthouse at dusk', aspect: '9:16' }),
    }),
  );
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  let job: { state: string; outputImageRef?: string } = { state: 'queued' };
  for (let i = 0; i < 40 && !['succeeded', 'failed'].includes(job.state); i++) {
    job = await (await getJob(new Request('http://localhost/x'), params({ id }))).json();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(job.state).toBe('succeeded');
  const sent = [...fake.jobs.values()][0]!.workflow as Record<string, { inputs: Record<string, unknown> }>;
  expect(sent['13']!.inputs).toMatchObject({ width: 720, height: 1280 });
  expect(sent['27']!.inputs.text).toBe('a lighthouse at dusk');
  const photo = readFileSync(join(dataDir(), job.outputImageRef!));
  expect(photo.subarray(1, 4).toString()).toBe('PNG');
}, 30_000);
