import { readImageTags } from '@montagio/sequence';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { readUploadMeta } from '@/server/uploads';
import { params, setupTempData } from './helpers';

setupTempData();
beforeEach(() => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});

const imageRequest = (body: unknown, key: string | null = 'k') =>
  new Request('http://localhost/api/images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('image job did not settle');
}

test('a text gives a tagged PNG upload, origin t2i, not personal', async () => {
  const res = await postImages(imageRequest({ prompt: 'a red fox in the snow', aspect: '16:9' }, 'img-1'));
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 't2i', modelId: 'z-image-turbo', label: { name: 'Z-Image Turbo' } });
  const done = await poll(created.id);
  expect(done).toMatchObject({ state: 'succeeded', personal: false, outputImageRef: expect.stringMatching(/^uploads\//) });
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 't2i', personal: false });
  expect(await readImageTags(mediaFileFor(done.outputUrl)!)).toMatchObject({ Comment: 'AI-generated' });
});

test('the same key again answers the same job with 200', async () => {
  const first = (await (await postImages(imageRequest({ prompt: 'a fox', aspect: '1:1' }, 'img-2'))).json()) as JobSummary;
  const again = await postImages(imageRequest({ prompt: 'a fox', aspect: '1:1' }, 'img-2'));
  expect(again.status).toBe(200);
  expect(((await again.json()) as JobSummary).id).toBe(first.id);
});

test('a blocked name is refused with 400 blocked-name', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const res = await postImages(imageRequest({ prompt: 'Taylor Swift on a beach', aspect: '16:9' }, 'img-3'));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'blocked-name' });
  warn.mockRestore();
});

test('an empty text or an unknown format is refused with invalid-input', async () => {
  for (const body of [{ prompt: '   ', aspect: '16:9' }, { prompt: 'a fox', aspect: '4:3' }, { aspect: '16:9' }]) {
    const res = await postImages(imageRequest(body, `img-${JSON.stringify(body)}`));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-input' });
  }
});

test('no idempotency key, 400', async () => {
  const res = await postImages(imageRequest({ prompt: 'a fox', aspect: '16:9' }, null));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'missing-idempotency-key' });
});

test('a text over the limit is cut to 500 characters, not refused', async () => {
  const res = await postImages(imageRequest({ prompt: `a fox ${'x'.repeat(600)}`, aspect: '16:9' }, 'img-4'));
  expect(res.status).toBe(201);
});
