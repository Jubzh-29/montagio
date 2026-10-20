import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeAudio, readTags } from '@montagio/sequence';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { jobs, readJobWorkflow } from '@/server/jobs';
import { resetServicesForTests } from '@/server/services';
import { params, pngFile, setupTempData, uploadRequest } from './helpers';

setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  vi.restoreAllMocks();
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const post = (body: unknown, key: string) =>
  postAvatars(
    new Request('http://localhost/api/avatars', {
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
  throw new Error('avatar did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const SPEECH = 'Hello, this is Montagio speaking from a single photo.';

test('an avatar is a voice then a clip, both tagged', async () => {
  const res = await post({ imageRef: await sampleRef(), text: SPEECH, language: 'en' }, 'av1');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'avatar', modelId: 'wan22-s2v-avatar' });
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect(done.outputUrl).toMatch(/\/output\.mp4$/);
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
  const info = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(info.avatarModel).toMatchObject({ id: 'wan22-s2v-avatar', license: 'Apache-2.0' });
  expect(info.estimates.avatar).toBeGreaterThan(0);
}, 30_000);

test('the clip is compiled for the length of the voice', async () => {
  const { id } = (await (await post({ imageRef: await sampleRef(), text: SPEECH, language: 'fr' }, 'av2')).json()) as JobSummary;
  await poll(id);
  const record = (await jobs.read(id))!;
  const voice = await probeAudio(record.steps[0]!.outputPath!);
  const { workflow } = (await readJobWorkflow(id))!;
  expect(workflow['96']!.inputs.length).toBe(Math.min(Math.ceil(16 * voice!.duration_s), 77));
}, 30_000);

test('a voice over 15 s ends in speech-too-long without submitting the avatar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-voice-'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=16', '-c:a', 'flac', join(dir, 'avatar-voice.flac')]);
  process.env.MONTAGIO_DEMO_AUDIO = dir;
  resetServicesForTests();
  try {
    const { id } = (await (await post({ imageRef: await sampleRef(), text: SPEECH, language: 'fr' }, 'av3')).json()) as JobSummary;
    const done = await poll(id);
    expect(done).toMatchObject({ state: 'failed', error: 'speech-too-long' });
    expect((await jobs.read(id))!.steps[1]!.backendJobId).toBeUndefined();
  } finally {
    delete process.env.MONTAGIO_DEMO_AUDIO;
    resetServicesForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('text over 300 characters: 400 invalid-input', async () => {
  const res = await post({ imageRef: await sampleRef(), text: 'a'.repeat(301), language: 'en' }, 'av4');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid-input' });
  expect((await post({ imageRef: await sampleRef(), text: SPEECH, language: 'de' }, 'av4-de')).status).toBe(400);
});

test('a personal photo without consent: 400 consent-required', async () => {
  const imageRef = ((await (await postUpload(uploadRequest(pngFile(1280, 720)))).json()) as { imageRef: string }).imageRef;
  const res = await post({ imageRef, text: SPEECH, language: 'en' }, 'av5');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'consent-required' });
});

test('a blocked name in the text: 400 blocked-name', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const res = await post({ imageRef: await sampleRef(), text: 'I am Lionel Messi and I approve this video.', language: 'en' }, 'av6');
  expect(await res.json()).toEqual({ error: 'blocked-name' });
});

test('avatar hidden: 404 extension-disabled', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit,effects';
  const res = await post({ imageRef: await sampleRef(), text: SPEECH, language: 'en' }, 'av7');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('an avatar comes back on the avatar tab with its text and language', async () => {
  const imageRef = await sampleRef();
  const { id } = (await (await post({ imageRef, text: SPEECH, language: 'fr' }, 'av8')).json()) as JobSummary;
  await poll(id);
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'avatar', reprise: { tab: 'avatar', imageRef, prompt: SPEECH, language: 'fr' } });
}, 30_000);
