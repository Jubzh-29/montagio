import { readTags } from '@montagio/sequence';
import { POST as postEffects } from '@/app/api/effects/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { readJobWorkflow } from '@/server/jobs';
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
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const post = (body: unknown, key: string) =>
  postEffects(
    new Request('http://localhost/api/effects', {
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
  throw new Error('effect did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const importedRef = async (width = 1280, height = 720) =>
  ((await (await postUpload(uploadRequest(pngFile(width, height)))).json()) as { imageRef: string }).imageRef;

test('Squish on a sample photo gives a tagged clip with its frame count', async () => {
  const res = await post({ imageRef: await sampleRef(), effectId: 'squish', subject: 'a toy car' }, 'fx1');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'effect', label: { itemId: 'squish', name: 'Squish' }, modelId: 'wan21-i2v-effects' });
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect(done.frames).toBeGreaterThan(0);
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
});

test('no subject: the preset says what the photo shows', async () => {
  const res = await post({ imageRef: await sampleRef(), effectId: 'squish' }, 'fx2');
  expect(res.status).toBe(201);
  const { workflow } = (await readJobWorkflow(((await res.json()) as JobSummary).id))!;
  expect(JSON.stringify(workflow)).toContain('miniature figure');
});

test('a personal photo without consent: 400 consent-required', async () => {
  const res = await post({ imageRef: await importedRef(), effectId: 'squish', subject: 'a dog' }, 'fx3');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'consent-required' });
});

test('an effect not dated is hidden without all: 404 extension-disabled', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'effects';
  const res = await post({ imageRef: await sampleRef(), effectId: 'squish', subject: 'a dog' }, 'fx4');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('an unknown effect: 404 extension-disabled', async () => {
  const res = await post({ imageRef: await sampleRef(), effectId: 'karaoke' }, 'fx5');
  expect(res.status).toBe(404);
});

test('a blocked name as the subject: 400 blocked-name', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const res = await post({ imageRef: await sampleRef(), effectId: 'explode', subject: 'Lionel Messi' }, 'fx6');
  expect(await res.json()).toEqual({ error: 'blocked-name' });
  warn.mockRestore();
});

test('a subject over the model limit: 400 invalid-input', async () => {
  const res = await post({ imageRef: await sampleRef(), effectId: 'squish', subject: 'x'.repeat(121) }, 'fx7');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid-input' });
});

test('a 9:16 photo gives a 9:16 render', async () => {
  const res = await post({ imageRef: await importedRef(720, 1280), effectId: 'snap-zoom', subject: 'a dog', consent: true }, 'fx8');
  expect(res.status).toBe(201);
  const { workflow } = (await readJobWorkflow(((await res.json()) as JobSummary).id))!;
  const model = (await getServices().library).extensionModels.get('wan21-i2v-effects')!;
  const at = (key: 'width' | 'height') => {
    const binding = model.bindings[key];
    const target = Array.isArray(binding) ? binding[0]! : binding!;
    return workflow[target.node]!.inputs[target.field];
  };
  expect([at('width'), at('height')]).toEqual([480, 832]);
});
