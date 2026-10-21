import { readFileSync } from 'node:fs';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { POST as postImageUpscale } from '@/app/api/images/upscale/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { readUploadMeta } from '@/server/uploads';
import { params, setupTempData } from './helpers';

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

const post = (body: unknown, key: string) =>
  postImageUpscale(
    new Request('http://localhost/api/images/upscale', {
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
  throw new Error('job did not settle');
}

test('a photo goes to HD: 2560 px on its long side, its provenance kept', async () => {
  const sample = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const res = await post({ imageRef: sample }, 'hd-photo-1');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'image-upscale', modelId: 'seedvr2-image-upscale', personal: false });
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 'sample', personal: false });
  const workflow = JSON.parse(readFileSync(mediaFileFor(`/media/data/jobs/${done.id}/step0.workflow.json`)!, 'utf8')) as Record<string, { inputs: Record<string, unknown> }>;
  expect(workflow['57']!.inputs).toMatchObject({ 'resize_type.width': 2560, 'resize_type.height': 1440 });
});

test('an unknown photo is refused; the HD photo hides with the upscale extension', async () => {
  expect(await (await post({ imageRef: 'uploads/nope.png' }, 'hd-photo-2')).json()).toEqual({ error: 'unknown-image' });
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  const sample = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  expect((await post({ imageRef: sample }, 'hd-photo-3')).status).toBe(404);
  expect(((await (await getExtensions()).json()) as ExtensionsInfo).estimates.imageUpscale).toBeUndefined();
});

test('the extensions say how long an HD photo takes', async () => {
  expect(((await (await getExtensions()).json()) as ExtensionsInfo).estimates.imageUpscale).toBeGreaterThan(0);
});
