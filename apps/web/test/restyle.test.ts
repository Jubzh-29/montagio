import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTags } from '@montagio/sequence';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postRestyle } from '@/app/api/restyle/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postVideo } from '@/app/api/uploads/video/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { readJobWorkflow } from '@/server/jobs';
import { params, setupTempData } from './helpers';

setupTempData();
let flag: string | undefined;
const scratch = mkdtempSync(join(tmpdir(), 'montagio-restyle-'));
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A clip as a phone films it: 832x480 at 25 fps, with sound. */
function clip(seconds: number, name: string): File {
  const path = join(scratch, name);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=832x480:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ]);
  return new File([readFileSync(path)], name, { type: 'video/mp4' });
}

const upload = (file: File) => {
  const form = new FormData();
  form.set('video', file);
  return postVideo(new Request('http://localhost/api/uploads/video', { method: 'POST', body: form }));
};

const post = (body: unknown, key: string) =>
  postRestyle(
    new Request('http://localhost/api/restyle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
  );

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('restyle did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const videoRef = async () => ((await (await upload(clip(3, 'clip.mp4'))).json()) as { videoRef: string }).videoRef;

test('restyle alone takes a clip: the video upload is open without the motion transfer', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'restyle';
  const res = await upload(clip(2, 'alone.mp4'));
  expect(res.status).toBe(201);
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  const hidden = await upload(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }));
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toEqual({ error: 'extension-disabled' });
}, 60_000);

test('a restyle without rights: 400 rights-required; without a text or with an unknown image: refused', async () => {
  const ref = await videoRef();
  const noRights = await post({ videoRef: ref, prompt: 'a snowy winter evening' }, 're1');
  expect(noRights.status).toBe(400);
  expect(await noRights.json()).toEqual({ error: 'rights-required' });
  const noText = await post({ videoRef: ref, prompt: '   ', rights: true }, 're2');
  expect(await noText.json()).toEqual({ error: 'invalid-input' });
  const unknown = await post({ videoRef: ref, prompt: 'snow', imageRef: 'uploads/nope.png', rights: true }, 're3');
  expect(await unknown.json()).toEqual({ error: 'unknown-image' });
  const noClip = await post({ videoRef: 'videos/nope.mp4', prompt: 'snow', rights: true }, 're4');
  expect(await noClip.json()).toEqual({ error: 'invalid-input' });
}, 60_000);

test("without a look image, the edit restyles the clip's first frame, which the restyle keeps", async () => {
  const res = await post({ videoRef: await videoRef(), prompt: 'a snowy winter evening', rights: true }, 're5');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'restyle', modelId: 'wan21-vace-restyle' });
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  const { record, workflow } = (await readJobWorkflow(created.id))!;
  expect(record.steps.map((step) => step.name)).toEqual(['first-frame', 'restyle']);
  expect(workflow['30']!.inputs).toMatchObject({ control_video: ['23', 0], control_masks: ['27', 0], reference_image: ['21', 0], width: 832, height: 480 });
  expect(workflow['14']!.inputs.text).toBe('a snowy winter evening');
}, 60_000);

test('with a look image, VACE follows it and no edit runs', async () => {
  const imageRef = await sampleRef();
  const { id } = (await (await post({ videoRef: await videoRef(), prompt: 'a watercolor painting', imageRef, rights: true }, 're6')).json()) as JobSummary;
  expect((await poll(id)).state).toBe('succeeded');
  const { record, workflow } = (await readJobWorkflow(id))!;
  expect(record.steps.map((step) => step.name)).toEqual(['restyle']);
  expect(workflow['30']!.inputs).toMatchObject({ control_video: ['4', 0], reference_image: ['21', 0] });
  expect(workflow['30']!.inputs).not.toHaveProperty('control_masks');
}, 60_000);

test('without the edit installed, the text alone drives the restyle', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'restyle';
  const { id } = (await (await post({ videoRef: await videoRef(), prompt: 'a watercolor painting', rights: true }, 're7')).json()) as JobSummary;
  expect((await poll(id)).state).toBe('succeeded');
  const { record, workflow } = (await readJobWorkflow(id))!;
  expect(record.steps.map((step) => step.name)).toEqual(['restyle']);
  expect(workflow['20']).toBeUndefined();
  expect(workflow['30']!.inputs.control_video).toEqual(['4', 0]);
}, 60_000);

test('restyle hidden: 404 extension-disabled', async () => {
  const ref = await videoRef();
  process.env.MONTAGIO_EXTENSIONS = 'motion';
  const res = await post({ videoRef: ref, prompt: 'snow', rights: true }, 're8');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
}, 60_000);

test('a restyle comes back on the Motion tab in its restyle mode, with its look image', async () => {
  const imageRef = await sampleRef();
  const ref = await videoRef();
  const { id } = (await (await post({ videoRef: ref, prompt: 'a watercolor painting', imageRef, rights: true }, 're9')).json()) as JobSummary;
  await poll(id);
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'restyle', reprise: { tab: 'motion', restyle: true, imageRef, videoRef: ref, prompt: 'a watercolor painting' } });
}, 60_000);
