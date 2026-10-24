import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readTags } from '@montagio/sequence';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as upscaleGeneration } from '@/app/api/generations/[id]/upscale/route';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as upscaleJob } from '@/app/api/jobs/[id]/upscale/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { jobs, readJobWorkflow } from '@/server/jobs';
import { generationRequest, params, seedRecordFile, setupTempData } from './helpers';

const dataDir = setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const CLIP = '00000000-0000-4000-8000-0000000000c1';

/** A finished camera clip: its record (with or without a frame count) and an 832x480 clip. */
function seedClip(frames?: number, aspect = '16:9'): void {
  seedRecordFile(dataDir(), {
    id: CLIP,
    presetId: 'crash-push',
    modelId: 'wan22-i2v-a14b-fun-camera',
    imageRef: 'uploads/00000000-0000-4000-8000-000000000001.png',
    seed: 1,
    aspect,
    state: 'succeeded',
    progress: 1,
    backendKind: 'demo',
    backendJobId: 'demo-1',
    outputUrl: `/media/data/generations/${CLIP}/clip.mp4`,
    ...(frames !== undefined ? { frames } : {}),
    idempotencyKey: 'clip-key',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=832x480:rate=16', '-frames:v', String(frames ?? 81), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dataDir(), 'generations', CLIP, 'clip.mp4')]);
}

const request = (key: string) => new Request('http://localhost/x', { method: 'POST', headers: { 'idempotency-key': key } });

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('HD did not settle');
}

test('a camera clip delivered now records its frame count', async () => {
  const { imageRef } = (await (await postSampleUpload()).json()) as { imageRef: string };
  const { id } = (await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'g-frames'))).json()) as { id: string };
  let record: { state: string; frames?: number } = { state: 'queued' };
  for (let i = 0; i < 20 && record.state !== 'succeeded'; i++) record = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
  expect(record.frames).toBe(80);
}, 30_000);

test("HD of an 81-frame clip: a tagged 1080p job on the clip's aspect", async () => {
  seedClip(81);
  const res = await upscaleGeneration(request('hd1'), params({ id: CLIP }));
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'upscale', modelId: 'seedvr2-upscale' });
  const { workflow } = (await readJobWorkflow(created.id))!;
  expect([workflow['57']!.inputs['resize_type.width'], workflow['57']!.inputs['resize_type.height']]).toEqual([1920, 1080]);
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  const info = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(info.upscaleModel).toMatchObject({ id: 'seedvr2-upscale', maxFrames: 121 });
}, 30_000);

test('HD with smooth: true keeps the RIFE frames in between; without it, the clip keeps its frame rate', async () => {
  seedClip(81);
  const smooth = new Request('http://localhost/x', { method: 'POST', headers: { 'idempotency-key': 'hd-smooth' }, body: JSON.stringify({ smooth: true }) });
  const smoothed = (await (await upscaleGeneration(smooth, params({ id: CLIP }))).json()) as JobSummary;
  const plain = (await (await upscaleGeneration(request('hd-plain'), params({ id: CLIP }))).json()) as JobSummary;
  const smoothFlow = (await readJobWorkflow(smoothed.id))!.workflow;
  const plainFlow = (await readJobWorkflow(plain.id))!.workflow;
  expect(smoothFlow['102']?.class_type).toBe('FrameInterpolate');
  expect(smoothFlow['75']!.inputs.fps).toEqual(['103', 0]);
  expect(plainFlow['102']).toBeUndefined();
  expect(plainFlow['75']!.inputs.fps).toEqual(['74', 2]);
  expect((await poll(smoothed.id)).state).toBe('succeeded');
}, 30_000);

test('HD of a clip over 121 frames or without a frame count: 400 invalid-input', async () => {
  seedClip(160);
  const over = await upscaleGeneration(request('hd2'), params({ id: CLIP }));
  expect(over.status).toBe(400);
  expect(await over.json()).toEqual({ error: 'invalid-input' });
  seedClip(undefined);
  expect((await upscaleGeneration(request('hd2-unknown'), params({ id: CLIP }))).status).toBe(400);
});

test('HD of an effect job goes through /api/jobs/:id/upscale', async () => {
  const { imageRef } = (await (await postSampleUpload()).json()) as { imageRef: string };
  const { record } = await jobs.create('effect', { imageRef, effectId: 'squish' }, 'fx-hd');
  for (let i = 0; i < 20 && (await jobs.get(record.id))!.state !== 'succeeded'; i++);
  const res = await upscaleJob(request('hd3'), params({ id: record.id }));
  expect(res.status).toBe(201);
  expect((await poll(((await res.json()) as JobSummary).id)).state).toBe('succeeded');
}, 60_000);

test('upscale hidden: 404 extension-disabled', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  seedClip(81);
  const res = await upscaleGeneration(request('hd4'), params({ id: CLIP }));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('an HD clip is a new history item that reopens its parent', async () => {
  seedClip(81);
  const { id } = (await (await upscaleGeneration(request('hd5'), params({ id: CLIP }))).json()) as JobSummary;
  await poll(id);
  const items = await listHistory();
  const hd = items.find((item) => item.key === `job:${id}`);
  expect(hd).toMatchObject({ kind: 'clip', task: 'upscale', name: 'Crash Push · HD', reprise: { tab: 'camera', presetId: 'crash-push' } });
  expect(items.some((item) => item.key === `generation:${CLIP}`)).toBe(true);
}, 30_000);
