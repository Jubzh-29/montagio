import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeAudio } from '@montagio/sequence';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getCaptions } from '@/app/api/captions/[id]/route';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postCaptions } from '@/app/api/jobs/[id]/captions/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { CaptionsInfo, ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { resetRejectedForTests } from '@/server/extensions';
import { listHistory } from '@/server/history';
import { jobDir, jobs, readJobWorkflow } from '@/server/jobs';
import { resetServicesForTests } from '@/server/services';
import { params, setupTempData } from './helpers';

setupTempData();
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of ['MONTAGIO_EXTENSIONS', 'MONTAGIO_EXPERIMENTAL', 'MONTAGIO_DEMO_CAPTIONS']) saved[name] = process.env[name];
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_EXPERIMENTAL = 'captions';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  resetRejectedForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const SPEECH = 'Hello, this is Montagio speaking from a single photo.';

const json = (path: string, body: unknown, key: string) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });

async function settle(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error(`job ${id} did not settle`);
}

async function avatar(key = 'av'): Promise<string> {
  const imageRef = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const created = (await (await postAvatars(json('/api/avatars', { imageRef, text: SPEECH, language: 'en' }, key))).json()) as JobSummary;
  expect((await settle(created.id)).state).toBe('succeeded');
  return created.id;
}

const captions = (parent: string, body: unknown, key: string) => postCaptions(json(`/api/jobs/${parent}/captions`, body, key), params({ id: parent }));
const info = async (id: string) => getCaptions(new Request('http://localhost/x'), params({ id }));

test('without MONTAGIO_EXPERIMENTAL=captions, captions are hidden', async () => {
  const parent = await avatar();
  delete process.env.MONTAGIO_EXPERIMENTAL;
  const res = await captions(parent, {}, 'c0');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
  expect(((await (await getExtensions()).json()) as ExtensionsInfo).captions).toBeUndefined();
}, 30_000);

test('a talking avatar is transcribed: the typed text is suggested, the words follow its voice', async () => {
  const parent = await avatar();
  expect(((await (await getExtensions()).json()) as ExtensionsInfo).captions).toMatchObject({ model: { id: 'whisper-turbo-words', license: 'MIT' } });
  const res = await captions(parent, { language: 'auto' }, 'c1');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'captions', modelId: 'whisper-turbo-words' });
  const done = await settle(created.id);
  expect(done.state).toBe('succeeded');

  const record = (await jobs.read(created.id))!;
  expect(record.parent).toEqual({ source: 'job', id: parent });
  const { workflow } = (await readJobWorkflow(created.id))!;
  expect(workflow['1']!.inputs.audio).toBe('speech.flac');
  expect(workflow['2']!.inputs.language).toBe('auto');
  expect(await probeAudio(join(jobDir(created.id), 'speech.flac'))).toMatchObject({ sampleRate: 16000, channels: 1 });

  const got = (await (await info(created.id)).json()) as CaptionsInfo;
  expect(got).toMatchObject({ jobId: created.id, parentId: parent, exports: [] });
  expect(got.transcript).toMatchObject({ language: 'en', supported: true, suggested: SPEECH, demo: true });
  const voice = (await probeAudio(join(jobDir(created.id), 'speech.flac')))!.duration_s;
  let floor = 0;
  for (const word of got.transcript.words) {
    expect(word.start).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(word.end).toBeLessThanOrEqual(voice + 1e-6);
    floor = word.end;
  }
  expect(got.transcript.words.map((word) => word.text).join(' ')).toBe(SPEECH);
  // A transcription alone is not a result of its own.
  expect((await listHistory()).some((item) => item.key === `job:${created.id}`)).toBe(false);
}, 30_000);

test('only a finished talking clip with a voice can be captioned', async () => {
  const parent = await avatar();
  for (const [body, key] of [
    [{ language: 'ja' }, 'c2'],
    [{ language: 'Klingon' }, 'c3'],
  ] as const) {
    const res = await captions(parent, body, key);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'language-unsupported' });
  }
  for (const [body, key] of [
    [{ export: { text: 'Hi', style: 'glitch' } }, 'c4'],
    [{ export: { text: 'x'.repeat(2001), style: 'pop' } }, 'c5'],
    [{ export: { text: '   ', style: 'pop' } }, 'c6'],
  ] as const) {
    const res = await captions(parent, body, key);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-input' });
  }
  const unknown = await captions('no-such-job', {}, 'c7');
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toEqual({ error: 'invalid-input' });
}, 30_000);

test('a clip without a voice is refused with no-speech', async () => {
  const parent = await avatar();
  const record = (await jobs.read(parent))!;
  // The demo's moved photo has no sound: the same as an avatar clip whose sound is gone.
  const { execFileSync } = await import('node:child_process');
  const silent = join(jobDir(parent), 'output.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=832x480:rate=16', '-t', '1', '-pix_fmt', 'yuv420p', silent]);
  expect(record.outputUrl).toMatch(/output\.mp4$/);
  const res = await captions(parent, {}, 'c8');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'no-speech' });
}, 30_000);

test('a language the captions do not cover is said so, not refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-words-'));
  writeFileSync(
    join(dir, '_default.json'),
    JSON.stringify({ schema: 'montagio/words@1', model: 'whisper-large-v3-turbo', language: 'ja', detected: true, duration_s: 1, text: ' こんにちは', chunks: [{ text: ' こんにちは', start: 0, end: 0.8 }] }),
  );
  process.env.MONTAGIO_DEMO_CAPTIONS = dir;
  resetServicesForTests();
  // A voice change of the avatar: no typed text, what Whisper heard is the text.
  const parent = await avatar('av-ja');
  const record = (await jobs.read(parent))!;
  record.inputs = { ...record.inputs, text: undefined };
  writeFileSync(join(jobDir(parent), 'record.json'), JSON.stringify(record));
  const created = (await (await captions(parent, {}, 'c9')).json()) as JobSummary;
  expect((await settle(created.id)).state).toBe('succeeded');
  const got = (await (await info(created.id)).json()) as CaptionsInfo;
  expect(got.transcript).toMatchObject({ language: 'ja', supported: false, suggested: 'こんにちは' });
}, 30_000);

test('a Whisper workflow ComfyUI refuses hides the captions, not the avatar', async () => {
  const parent = await avatar();
  const { getServices } = await import('@/server/services');
  const { BackendError } = await import('@montagio/comfy-adapter');
  vi.spyOn(getServices().backend, 'submit').mockRejectedValueOnce(new BackendError('workflow-rejected', false, 'MontagioTranscribeWords is not a node'));
  const res = await captions(parent, {}, 'c10');
  expect(res.status).toBeGreaterThanOrEqual(400);
  const after = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(after.captions).toBeUndefined();
  expect(after.extensions).toContain('avatar');
}, 30_000);

test('GET /api/captions/:id answers 404 for a job that is not a finished transcription', async () => {
  const parent = await avatar();
  expect((await info(parent)).status).toBe(404);
  expect((await info('nope')).status).toBe(404);
}, 30_000);
