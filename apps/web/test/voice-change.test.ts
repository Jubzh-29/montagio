import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeAudio, readTags } from '@montagio/sequence';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postSpeech } from '@/app/api/uploads/speech/route';
import { POST as postVoice } from '@/app/api/uploads/voice/route';
import { POST as postVoiceChanges } from '@/app/api/voice-changes/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { readJobWorkflow } from '@/server/jobs';
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

/** A file made by FFmpeg from `args`, sent as a form field. */
function form(field: string, name: string, type: string, args: string[]): Request {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-vc-'));
  const file = join(dir, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, file]);
  const data = new FormData();
  data.append(field, new File([readFileSync(file)], name, { type }));
  rmSync(dir, { recursive: true, force: true });
  return new Request('http://localhost/api/uploads/x', { method: 'POST', body: data });
}

const talkingVideo = () =>
  form('video', 'talk.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=16', '-f', 'lavfi', '-i', 'sine=frequency=200', '-t', '4', '-pix_fmt', 'yuv420p', '-shortest']);
const voiceSample = async () =>
  ((await (await postVoice(form('audio', 'voice.wav', 'audio/wav', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=6']))).json()) as { voiceRef: string }).voiceRef;

test('a video with sound is kept with its sound; a silent one is refused', async () => {
  const res = await postSpeech(talkingVideo());
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ speechRef: expect.stringMatching(/^speech\/[0-9a-f-]{36}\.mp4$/), audioRef: expect.stringMatching(/\.flac$/), aspect: '16:9' });
  const silent = await postSpeech(form('video', 'silent.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=16', '-t', '2', '-pix_fmt', 'yuv420p']));
  expect(silent.status).toBe(400);
}, 60_000);

test('the voice changes under the picture, with the speaker of the sample agreeing and the rights on the video', async () => {
  const { speechRef } = (await (await postSpeech(talkingVideo())).json()) as { speechRef: string };
  const voiceRef = await voiceSample();
  expect(await (await postVoiceChanges(request({ speechRef, voiceRef, rights: true }, 'vc-1'))).json()).toEqual({ error: 'consent-required' });
  expect(await (await postVoiceChanges(request({ speechRef, voiceRef, voiceConsent: true }, 'vc-2'))).json()).toEqual({ error: 'rights-required' });
  expect(await (await postVoiceChanges(request({ speechRef, voiceRef: 'voices/nope.flac', voiceConsent: true, rights: true }, 'vc-3'))).json()).toEqual({ error: 'invalid-input' });
  const res = await postVoiceChanges(request({ speechRef, voiceRef, voiceConsent: true, rights: true }, 'vc-4'));
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'voice-change', modelId: 'chatterbox-vc' });
  const file = mediaFileFor(done.outputUrl)!;
  expect(file).toMatch(/voice-change\.mp4$/);
  expect(await probeAudio(file)).not.toBeNull();
  expect((await readTags(file)).comment).toBe('AI-generated');
  const { workflow } = (await readJobWorkflow(done.id))!;
  expect(workflow['2']!.class_type).toBe('ChatterboxVC');
}, 60_000);

test('an avatar made here changes voice without a rights box', async () => {
  const sample = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const avatar = await poll(((await (await postAvatars(request({ imageRef: sample, text: 'Hello from Montagio.', language: 'en' }, 'vc-av'))).json()) as JobSummary).id);
  expect(avatar.state).toBe('succeeded');
  const res = await postVoiceChanges(request({ sourceJobId: avatar.id, voiceRef: await voiceSample(), voiceConsent: true }, 'vc-5'));
  expect(res.status).toBe(201);
  expect((await poll(((await res.json()) as JobSummary).id)).state).toBe('succeeded');
}, 60_000);

test('without the avatar extension there is no voice change', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  expect((await postVoiceChanges(request({ speechRef: 'speech/x.mp4', voiceRef: 'voices/x.flac', voiceConsent: true, rights: true }, 'vc-6'))).status).toBe(404);
});
