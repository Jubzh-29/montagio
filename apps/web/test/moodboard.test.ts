import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as postEdits } from '@/app/api/edits/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postMoodboards } from '@/app/api/moodboards/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import type { JobSummary } from '@/lib/api-types';
import { MOODBOARD_INSTRUCTION, PALETTE_FROM_PHOTO_INSTRUCTION, paletteInstruction } from '@/lib/image-style';
import { jobDir, readJobWorkflow } from '@/server/jobs';
import { readUploadMeta } from '@/server/uploads';
import { params, setupTempData, uploadRequest } from './helpers';

setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_EXPERIMENTAL = 'moodboard,palette-photo';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
  delete process.env.MONTAGIO_EXPERIMENTAL;
});

test('without MONTAGIO_EXPERIMENTAL, no moodboard and no palette from a photo', async () => {
  delete process.env.MONTAGIO_EXPERIMENTAL;
  const made = await madeRef('x-ref');
  expect((await post(postMoodboards, { prompt: 'a red bicycle', aspect: '16:9', refs: [made] }, 'x-1')).status).toBe(404);
  expect((await post(postEdits, { imageRef: made, image2Ref: made, instruction: PALETTE_FROM_PHOTO_INSTRUCTION }, 'x-2')).status).toBe(404);
  // The ready-made palettes need no flag.
  expect((await post(postEdits, { imageRef: made, instruction: paletteInstruction('noir') }, 'x-3')).status).toBe(201);
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
  for (let i = 0; i < 30; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('job did not settle');
}

/** A picture made from a text here: fictional, and a real PNG the sheet can read. */
const madeRef = async (key: string) =>
  (await poll(((await (await post(postImages, { prompt: 'a misty pine forest at dawn', aspect: '16:9' }, key)).json()) as JobSummary).id)).outputImageRef!;

/** A real PNG imported by the visitor: personal. */
async function importedRef(colour: string): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'montagio-mood-')), `${colour}.png`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=640x480`, '-frames:v', '1', file]);
  const res = await postUpload(uploadRequest(new File([readFileSync(file)], `${colour}.png`, { type: 'image/png' })));
  return ((await res.json()) as { imageRef: string }).imageRef;
}

test('a moodboard picture: made from the text, then given the look of a sheet of the references', async () => {
  const refs = [await madeRef('m-ref-1'), await madeRef('m-ref-2'), await madeRef('m-ref-3')];
  const res = await post(postMoodboards, { prompt: 'a cup of coffee on a wooden table', aspect: '1:1', refs }, 'm-1');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'moodboard' });
  expect(done.outputImageRef).toBeTruthy();
  // The references are pictures of no one, made here: so is the result.
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ origin: 'edit', personal: false, fictional: true });
  expect(existsSync(join(jobDir(done.id), 'moodboard.png'))).toBe(true);
  const { workflow } = (await readJobWorkflow(done.id))!;
  expect(JSON.stringify(workflow)).toContain(MOODBOARD_INSTRUCTION.slice(0, 40));
});

test('a moodboard refuses no reference, five, an unknown one, or a text too long; an imported one asks for consent', async () => {
  const made = await madeRef('m-ref-4');
  const ask = (body: Record<string, unknown>, key: string) => post(postMoodboards, { prompt: 'a red bicycle', aspect: '16:9', ...body }, key);
  expect((await ask({ refs: [] }, 'm-2')).status).toBe(400);
  expect((await ask({ refs: [made, made, made, made, made] }, 'm-3')).status).toBe(400);
  expect(await (await ask({ refs: ['uploads/nope.png'] }, 'm-4')).json()).toEqual({ error: 'unknown-image' });
  expect((await ask({ refs: [made], prompt: 'x'.repeat(301) }, 'm-5')).status).toBe(400);
  const imported = await importedRef('teal');
  expect(await (await ask({ refs: [made, imported] }, 'm-6')).json()).toEqual({ error: 'consent-required' });
  const res = await ask({ refs: [made, imported], consent: true }, 'm-7');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ personal: true });
  expect((await readUploadMeta(done.outputImageRef!))?.fictional).toBeUndefined();
});

test('a palette recolors the photo; from a photo, that photo is the edit\'s second image', async () => {
  const photo = await madeRef('p-photo');
  const preset = await poll(((await (await post(postEdits, { imageRef: photo, instruction: paletteInstruction('tealOrange') }, 'p-1')).json()) as JobSummary).id);
  expect(preset.state).toBe('succeeded');
  const colours = await importedRef('orange');
  expect(await (await post(postEdits, { imageRef: photo, image2Ref: colours, instruction: PALETTE_FROM_PHOTO_INSTRUCTION }, 'p-2')).json()).toEqual({ error: 'consent-required' });
  const res = await post(postEdits, { imageRef: photo, image2Ref: colours, instruction: PALETTE_FROM_PHOTO_INSTRUCTION, consent: true }, 'p-3');
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done.state).toBe('succeeded');
  const { workflow } = (await readJobWorkflow(done.id))!;
  expect(workflow['42']!.inputs.image).toBeTruthy();
  expect(await readUploadMeta(done.outputImageRef!)).toMatchObject({ personal: true });
  expect(await (await post(postEdits, { imageRef: photo, image2Ref: 'uploads/nope.png', instruction: PALETTE_FROM_PHOTO_INSTRUCTION }, 'p-4')).json()).toEqual({ error: 'unknown-image' });
});
