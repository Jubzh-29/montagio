import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTags } from '@montagio/sequence';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postSwap } from '@/app/api/swap/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postVideo } from '@/app/api/uploads/video/route';
import type { ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { readJobWorkflow } from '@/server/jobs';
import { params, setupTempData } from './helpers';

setupTempData();
let flag: string | undefined;
const scratch = mkdtempSync(join(tmpdir(), 'montagio-swap-'));
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

/** A clip as a phone films it: 1280x720 at 25 fps, with sound. */
function clip(seconds: number, name: string): File {
  const path = join(scratch, name);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=${seconds}`,
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
  postSwap(
    new Request('http://localhost/api/swap', {
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
  throw new Error('swap did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const videoRef = async () => ((await (await upload(clip(3, 'clip.mp4'))).json()) as { videoRef: string }).videoRef;
const centre = [{ x: 0.5, y: 0.5 }];

test('a swap without rights, points, text or a known clip or photo is refused', async () => {
  const ref = await videoRef();
  const noRights = await post({ videoRef: ref, prompt: 'a red motorbike', points: centre }, 'sw1');
  expect(noRights.status).toBe(400);
  expect(await noRights.json()).toEqual({ error: 'rights-required' });
  const refused = [
    { videoRef: ref, prompt: '  ', points: centre, rights: true },
    { videoRef: ref, prompt: 'a red motorbike', rights: true },
    { videoRef: ref, prompt: 'a red motorbike', points: [], rights: true },
    { videoRef: ref, prompt: 'a red motorbike', points: [{ x: 412, y: 300 }], rights: true },
    { videoRef: ref, prompt: 'a red motorbike', points: Array.from({ length: 9 }, () => centre[0]), rights: true },
    { videoRef: ref, prompt: 'a red motorbike', points: centre, exclude: 'here', rights: true },
    // a 1280x720 clip in 832x480 loses 16 px on each side: a point on the far left is cut away
    { videoRef: ref, prompt: 'a red motorbike', points: [{ x: 0.005, y: 0.5 }], rights: true },
    { videoRef: 'videos/nope.mp4', prompt: 'a red motorbike', points: centre, rights: true },
  ];
  for (const [i, body] of refused.entries()) {
    expect({ i, answer: await (await post(body, `sw2-${i}`)).json() }).toEqual({ i, answer: { error: 'invalid-input' } });
  }
  const unknown = await post({ videoRef: ref, prompt: 'a red motorbike', points: centre, imageRef: 'uploads/nope.png', rights: true }, 'sw3');
  expect(await unknown.json()).toEqual({ error: 'unknown-image' });
}, 60_000);

test('the points mark the object for the tracker, and the text alone redraws it', async () => {
  const res = await post({ videoRef: await videoRef(), prompt: 'a red vintage motorbike', points: [{ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.75 }], exclude: [{ x: 0.9, y: 0.1 }], rights: true }, 'sw4');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'swap', modelId: 'wan21-vace-swap' });
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  const { record, workflow } = (await readJobWorkflow(created.id))!;
  expect(record.steps.map((step) => step.name)).toEqual(['swap']);
  expect(JSON.parse(String(workflow['41']!.inputs.coordinates_positive))).toEqual([{ x: 416, y: 240 }, { x: 203, y: 360 }]);
  expect(JSON.parse(String(workflow['41']!.inputs.coordinates_negative))).toEqual([{ x: 757, y: 48 }]);
  expect(workflow['14']!.inputs.text).toBe('a red vintage motorbike');
  expect(workflow['20']).toBeUndefined();
  expect(workflow['30']!.inputs).toMatchObject({ control_video: ['45', 0], control_masks: ['43', 0], width: 832, height: 480 });
}, 60_000);

test("with a photo of the new object, VACE follows it; Reuse brings back the clip, the text and the photo", async () => {
  const imageRef = await sampleRef();
  const ref = await videoRef();
  const { id } = (await (await post({ videoRef: ref, prompt: 'a golden retriever', points: centre, imageRef, rights: true }, 'sw5')).json()) as JobSummary;
  expect((await poll(id)).state).toBe('succeeded');
  const { workflow } = (await readJobWorkflow(id))!;
  expect(workflow['30']!.inputs.reference_image).toEqual(['21', 0]);
  expect(workflow['21']!.inputs).toMatchObject({ padding_color: 'white' });
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'swap', reprise: { tab: 'motion', swap: true, imageRef, videoRef: ref, prompt: 'a golden retriever' } });
}, 60_000);

test('swap hidden, or its requirement hidden: 404 extension-disabled, and no estimate', async () => {
  const ref = await videoRef();
  process.env.MONTAGIO_EXTENSIONS = 'motion,restyle';
  const res = await post({ videoRef: ref, prompt: 'a red motorbike', points: centre, rights: true }, 'sw6');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
  const info = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(info.estimates.swap).toBeUndefined();
  expect(info.swapModel).toBeUndefined();
  process.env.MONTAGIO_EXTENSIONS = 'all';
  const all = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(all.estimates.swap).toBeGreaterThan(0);
  expect(all.swapModel).toMatchObject({ id: 'wan21-vace-swap', license: 'Apache-2.0' });
}, 60_000);
