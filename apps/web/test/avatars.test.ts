import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeAudio, readTags } from '@montagio/sequence';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postVoice } from '@/app/api/uploads/voice/route';
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

test('a voice under 1 s ends in speech-too-short without submitting the avatar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-voice-'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.5', '-c:a', 'flac', join(dir, 'avatar-voice.flac')]);
  process.env.MONTAGIO_DEMO_AUDIO = dir;
  resetServicesForTests();
  try {
    const { id } = (await (await post({ imageRef: await sampleRef(), text: 'Hi!', language: 'en' }, 'av-short')).json()) as JobSummary;
    expect(await poll(id)).toMatchObject({ state: 'failed', error: 'speech-too-short' });
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

/** A voice sample of `seconds`, as a browser sends one (multipart field "audio"). */
function voiceRequest(seconds: number, type = 'audio/wav'): Request {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-voice-'));
  const file = join(dir, 'sample.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=180:duration=${seconds}`, file]);
  const form = new FormData();
  form.append('audio', new File([readFileSync(file)], 'sample.wav', { type }));
  rmSync(dir, { recursive: true, force: true });
  return new Request('http://localhost/api/uploads/voice', { method: 'POST', body: form });
}

test('a voice sample is kept as 20 s of mono FLAC at most; a short or unreadable one is refused', async () => {
  const long = await postVoice(voiceRequest(25));
  expect(long.status).toBe(201);
  const sample = (await long.json()) as { voiceRef: string; duration_s: number };
  expect(sample.voiceRef).toMatch(/^voices\/[0-9a-f-]{36}\.flac$/);
  expect(sample.duration_s).toBeCloseTo(20, 0);
  const probed = await probeAudio(join(process.env.MONTAGIO_DATA!, 'uploads', ...sample.voiceRef.split('/')));
  expect(probed).toMatchObject({ codec: 'flac', channels: 1, sampleRate: 24000 });
  expect((await postVoice(voiceRequest(1))).status).toBe(400);
  expect((await postVoice(voiceRequest(4, 'video/mp4'))).status).toBe(415);
}, 30_000);

test('an avatar speaks with a voice sample only with its speaker\'s consent', async () => {
  const { voiceRef } = (await (await postVoice(voiceRequest(6))).json()) as { voiceRef: string };
  const photo = await sampleRef();
  expect(await (await post({ imageRef: photo, text: SPEECH, language: 'en', voiceRef }, 'av-voice-1')).json()).toEqual({ error: 'consent-required' });
  expect(await (await post({ imageRef: photo, text: SPEECH, language: 'en', voiceRef: 'voices/nope.flac', voiceConsent: true }, 'av-voice-2')).json()).toEqual({ error: 'invalid-input' });
  const res = await post({ imageRef: photo, text: SPEECH, language: 'en', voiceRef, voiceConsent: true }, 'av-voice-3');
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as JobSummary;
  await poll(id);
  const voice = JSON.parse(readFileSync(mediaFileFor(`/media/data/jobs/${id}/step0.workflow.json`)!, 'utf8')) as Record<string, { inputs: Record<string, unknown> }>;
  expect(voice['2']!.inputs.audio_prompt).toEqual(['4', 0]);
  expect(voice['4']!.inputs.audio).toBe(voiceRef);
}, 30_000);
