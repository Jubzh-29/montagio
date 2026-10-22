import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTags } from '@montagio/sequence';
import { POST as postEffects } from '@/app/api/effects/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { jobs, readJobWorkflow } from '@/server/jobs';
import { getServices, resetServicesForTests } from '@/server/services';
import { params, pngFile, repoRoot, setupTempData, uploadRequest } from './helpers';

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
  // FFmpeg tags and probes the clip: on a loaded machine that passes the 5 s default.
}, 30_000);

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
  const imageRef = await sampleRef();
  // Every effect is dated since GPU session S2: a copy of the library where Squish lost its date.
  const root = mkdtempSync(join(tmpdir(), 'montagio-fx-root-'));
  try {
    for (const dir of ['presets', 'registry', 'workflows']) cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
    const squish = join(root, 'presets', 'effects', 'squish.yaml');
    writeFileSync(squish, readFileSync(squish, 'utf8').replace(/^gpu_validated: .*\n?/m, ''));
    process.env.MONTAGIO_ROOT = root;
    resetServicesForTests();
    process.env.MONTAGIO_EXTENSIONS = 'effects';
    const res = await post({ imageRef, effectId: 'squish', subject: 'a dog' }, 'fx4');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'extension-disabled' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

describe('a start photo composed from a place, a character and a product', () => {
  const madeFromText = async (prompt: string, key: string) => {
    const res = await postImages(new Request('http://localhost/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ prompt, aspect: '16:9' }),
    }));
    const job = (await res.json()) as JobSummary;
    for (let i = 0; i < 20; i++) {
      const done = (await (await getJob(new Request('http://localhost/x'), params({ id: job.id }))).json()) as JobSummary;
      if (done.state === 'succeeded') return done.outputImageRef!;
    }
    throw new Error('the reference photo did not settle');
  };

  test('the edit composes first, then the effect runs on what it made', async () => {
    process.env.MONTAGIO_EXTENSIONS = 'all';
    const location = await madeFromText('a sunny beach', 'compose-l');
    const product = await madeFromText('a red soda can', 'compose-p');
    const character = await madeFromText('a fictional surfer', 'compose-c');
    const res = await post({ effectId: 'squish', compose: { location, character, product } }, 'compose-1');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as JobSummary;
    await poll(id);
    const record = (await jobs.read(id))!;
    expect(record.state).toBe('succeeded');
    expect(record.steps.map((step) => step.name)).toEqual(['compose', 'effect']);
    expect(record.inputs.personal).toBe(false);
  });

  test('one reference is refused; an imported one asks for consent', async () => {
    process.env.MONTAGIO_EXTENSIONS = 'all';
    const location = await madeFromText('a quiet street', 'compose-l2');
    expect(await (await post({ effectId: 'squish', compose: { location } }, 'compose-2')).json()).toEqual({ error: 'invalid-input' });
    const imported = ((await (await postUpload(uploadRequest(pngFile(1280, 720)))).json()) as { imageRef: string }).imageRef;
    expect(await (await post({ effectId: 'squish', compose: { location, character: imported } }, 'compose-3')).json()).toEqual({ error: 'consent-required' });
    expect((await post({ effectId: 'squish', compose: { location, character: imported }, consent: true }, 'compose-4')).status).toBe(201);
  });
});
