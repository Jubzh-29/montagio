import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postTranslations } from '@/app/api/translations/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postSpeech } from '@/app/api/uploads/speech/route';
import { TRANSLATE_LANGUAGES } from '@montagio/presets';
import type { JobSummary } from '@/lib/api-types';
import { TRANSLATE_CHOICES } from '@/lib/translate';
import { jobs, readJobWorkflow } from '@/server/jobs';
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

async function avatarJob(key: string): Promise<JobSummary> {
  const sample = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  return poll(((await (await postAvatars(request({ imageRef: sample, text: 'Hello from Montagio.', language: 'en' }, key))).json()) as JobSummary).id);
}

function talkingVideo(): Request {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-tr-'));
  const file = join(dir, 'talk.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=16', '-f', 'lavfi', '-i', 'sine=frequency=200', '-t', '4', '-pix_fmt', 'yuv420p', '-shortest', file]);
  const data = new FormData();
  data.append('video', new File([readFileSync(file)], 'talk.mp4', { type: 'video/mp4' }));
  rmSync(dir, { recursive: true, force: true });
  return new Request('http://localhost/api/uploads/speech', { method: 'POST', body: data });
}

test('an avatar made here is said again in Spanish: the speech translated, then the face animated on it', async () => {
  const avatar = await avatarJob('tr-av-1');
  expect(avatar.state).toBe('succeeded');
  const res = await postTranslations(request({ sourceJobId: avatar.id, language: 'es' }, 'tr-1'));
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'translate', modelId: 'wan22-s2v-avatar' });
  expect(done.outputUrl).toMatch(/\.mp4$/);
  const record = (await jobs.read(done.id))!;
  expect(record.inputs).toMatchObject({ language: 'es', speech: { jobId: avatar.id } });
  expect(record.steps.map((step) => step.name)).toEqual(['translate', 'avatar']);
  const { workflow } = (await readJobWorkflow(done.id))!;
  expect(Object.values(workflow).some((node) => node.class_type === 'WanSoundImageToVideo')).toBe(true);
});

test('a video sent here needs its rights and its speaker\'s consent; its first frame is the face', async () => {
  const { speechRef } = (await (await postSpeech(talkingVideo())).json()) as { speechRef: string };
  expect(await (await postTranslations(request({ speechRef, language: 'fr', consent: true }, 'tr-2'))).json()).toEqual({ error: 'rights-required' });
  expect(await (await postTranslations(request({ speechRef, language: 'fr', rights: true }, 'tr-3'))).json()).toEqual({ error: 'consent-required' });
  const res = await postTranslations(request({ speechRef, language: 'fr', rights: true, consent: true }, 'tr-4'));
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done.state).toBe('succeeded');
  const record = (await jobs.read(done.id))!;
  expect(await readUploadMeta(String(record.inputs.imageRef))).toMatchObject({ origin: 'frame', personal: true, aspect: '16:9' });
});

test('an unknown language, an unknown source or a hidden avatar extension is refused', async () => {
  const avatar = await avatarJob('tr-av-2');
  expect((await postTranslations(request({ sourceJobId: avatar.id, language: 'xx' }, 'tr-5'))).status).toBe(400);
  expect((await postTranslations(request({ sourceJobId: 'nope', language: 'es' }, 'tr-6'))).status).toBe(400);
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  expect((await postTranslations(request({ sourceJobId: avatar.id, language: 'es' }, 'tr-7'))).status).toBe(404);
});

test('the page offers the languages the server translates into', () => {
  expect(TRANSLATE_CHOICES.map(([value]) => value)).toEqual([...TRANSLATE_LANGUAGES]);
});
