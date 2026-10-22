import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, probeAudio, readTags } from '@montagio/sequence';
import { POST as postAds } from '@/app/api/ads/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { jobs } from '@/server/jobs';
import { params, pngFile, setupTempData, uploadRequest } from './helpers';

setupTempData();
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

const request = (body: unknown, key: string) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 30; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('job did not settle');
}

/** A product photo made from a text: not personal, no consent to give. */
async function product(key: string): Promise<string> {
  const job = (await (await postImages(request({ prompt: 'a glass bottle of lemonade', aspect: '9:16' }, key))).json()) as JobSummary;
  return (await poll(job.id)).outputImageRef!;
}

const upload = async (width: number, height: number) => ((await (await postUpload(uploadRequest(pngFile(width, height)))).json()) as { imageRef: string }).imageRef;

/** A real transparent PNG of the 9:16 cut's size, as the browser draws the tagline. */
async function taglinePng(): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'montagio-ad-')), 'tagline.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white@0.4:s=720x1280,format=rgba', '-frames:v', '1', file]);
  const res = await postUpload(uploadRequest(new File([readFileSync(file)], 'tagline.png', { type: 'image/png' })));
  return ((await res.json()) as { imageRef: string }).imageRef;
}

test('an ad is a scene, an effect and music, delivered in 9:16 with its tagline, sound and AI mention', async () => {
  const overlayRef = await taglinePng();
  const res = await postAds(request({ productRef: await product('ad-p1'), style: 'bold', effectId: 'snap-zoom', tagline: 'Fresh every day', overlayRef }, 'ad-1'));
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'ad', label: { name: 'Ad · Snap Zoom' } });
  expect((await jobs.read(done.id))!.steps.map((step) => step.name)).toEqual(['scene', 'effect', 'music']);
  const file = mediaFileFor(done.outputUrl)!;
  expect(file).toMatch(/ad\.mp4$/);
  expect(await probe(file)).toMatchObject({ width: 720, height: 1280 });
  expect(await probeAudio(file)).not.toBeNull();
  expect((await readTags(file)).comment).toBe('AI-generated');
}, 60_000);

test('without a tagline the 9:16 cut is the ad', async () => {
  const done = await poll(((await (await postAds(request({ productRef: await product('ad-p2'), style: 'studio', effectId: 'squish' }, 'ad-2'))).json()) as JobSummary).id);
  expect(mediaFileFor(done.outputUrl)).toMatch(/ad-9x16\.mp4$/);
}, 60_000);

test('a style, an overlay or a tagline out of bounds is refused; an imported photo asks for consent', async () => {
  const productRef = await product('ad-p3');
  const refused = async (body: Record<string, unknown>, key: string) => (await postAds(request({ productRef, style: 'studio', effectId: 'squish', ...body }, key))).json();
  expect(await refused({ style: 'retro' }, 'ad-3')).toEqual({ error: 'invalid-input' });
  expect(await refused({ overlayRef: await upload(1280, 720) }, 'ad-4')).toEqual({ error: 'invalid-input' });
  expect(await refused({ tagline: 'x'.repeat(61) }, 'ad-5')).toEqual({ error: 'invalid-input' });
  expect(await refused({ characterRef: await upload(720, 1280) }, 'ad-6')).toEqual({ error: 'consent-required' });
  expect(await refused({ effectId: 'nope' }, 'ad-7')).toEqual({ error: 'extension-disabled' });
});

test('without the music extension there is no ad', async () => {
  const productRef = await product('ad-p4');
  process.env.MONTAGIO_EXTENSIONS = 'edit,effects';
  expect((await postAds(request({ productRef, style: 'studio', effectId: 'squish' }, 'ad-8'))).status).toBe(404);
});
