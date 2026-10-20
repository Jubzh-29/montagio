import { POST as postEdits } from '@/app/api/edits/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { JobSummary } from '@/lib/api-types';
import { readUploadMeta } from '@/server/uploads';
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

const post = (route: (request: Request) => Promise<Response>, body: unknown, key: string) =>
  route(
    new Request('http://localhost/api/x', {
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

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const importedRef = async () => ((await (await postUpload(uploadRequest(pngFile(1280, 720)))).json()) as { imageRef: string }).imageRef;

test('an edit of a sample photo needs no consent and gives an edit upload', async () => {
  const res = await post(postEdits, { imageRef: await sampleRef(), instruction: 'make it snow' }, 'e1');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'edit', modelId: 'qwen-image-edit-2511', personal: false });
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 'edit', personal: false });
});

test('an edit of an imported photo without consent: 400 consent-required', async () => {
  const res = await post(postEdits, { imageRef: await importedRef(), instruction: 'make it snow' }, 'e2');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'consent-required' });
});

test('with consent it is accepted, and the result stays personal', async () => {
  const res = await post(postEdits, { imageRef: await importedRef(), instruction: 'make it snow', consent: true }, 'e3');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done.personal).toBe(true);
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 'edit', personal: true });
});

test('an edit of a text-made photo is not personal', async () => {
  const image = await poll(((await (await post(postImages, { prompt: 'a red fox', aspect: '16:9' }, 'e4-img')).json()) as JobSummary).id);
  const res = await post(postEdits, { imageRef: image.outputImageRef, instruction: 'make it night', look: 'infl8' }, 'e4');
  expect(res.status).toBe(201);
  expect((await poll(((await res.json()) as JobSummary).id)).personal).toBe(false);
});

test('edit hidden by the flag: 404 extension-disabled', async () => {
  delete process.env.MONTAGIO_EXTENSIONS;
  const res = await post(postEdits, { imageRef: await sampleRef(), instruction: 'make it snow' }, 'e5');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('an unknown look, or no instruction: 400 invalid-input', async () => {
  const imageRef = await sampleRef();
  for (const [body, key] of [
    [{ imageRef, instruction: 'make it snow', look: 'karaoke' }, 'e6'],
    [{ imageRef, instruction: '  ' }, 'e7'],
  ] as const) {
    const res = await post(postEdits, body, key);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-input' });
  }
});

test('an unknown imageRef: 400 unknown-image; a blocked name: 400 blocked-name', async () => {
  const unknown = await post(postEdits, { imageRef: 'uploads/00000000-0000-4000-8000-000000000000.png', instruction: 'make it snow' }, 'e8');
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toEqual({ error: 'unknown-image' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const named = await post(postEdits, { imageRef: await sampleRef(), instruction: 'turn him into Elon Musk' }, 'e9');
  expect(await named.json()).toEqual({ error: 'blocked-name' });
  warn.mockRestore();
});
