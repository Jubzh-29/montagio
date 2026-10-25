import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecipe, type Recipe } from '@montagio/recipe';
import { sameWorkflows } from '@montagio/recipe/same';
import { probe, probeAudio, readTags } from '@montagio/sequence';
import { POST as postAvatars } from '@/app/api/avatars/route';
import { GET as getCaptions } from '@/app/api/captions/[id]/route';
import { POST as postExport } from '@/app/api/captions/[id]/export/route';
import { GET as getExport } from '@/app/api/captions/[id]/export/[exportId]/route';
import { POST as postPreview } from '@/app/api/captions/[id]/preview/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postCaptions } from '@/app/api/jobs/[id]/captions/route';
import { GET as getRecipe } from '@/app/api/recipes/[source]/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { CaptionExportSummary, CaptionsInfo, JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { jobDir, jobs } from '@/server/jobs';
import { resetServicesForTests } from '@/server/services';
import { params, setupTempData } from './helpers';

setupTempData();
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of ['MONTAGIO_EXTENSIONS', 'MONTAGIO_DEMO_CAPTIONS']) saved[name] = process.env[name];
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const SPEECH = 'Hello, this is a test of the Shot Rate avatar.';
const FIXED = 'Hello, this is a test of the Montagio avatar.';

const post = (path: string, body: unknown, key = crypto.randomUUID()) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });

async function settle(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error(`job ${id} did not settle`);
}

async function talkingAvatar(): Promise<string> {
  const imageRef = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const created = (await (await postAvatars(post('/api/avatars', { imageRef, text: SPEECH, language: 'en' }))).json()) as JobSummary;
  expect((await settle(created.id)).state).toBe('succeeded');
  return created.id;
}

async function transcribed(): Promise<{ parent: string; id: string }> {
  const parent = await talkingAvatar();
  const created = (await (await postCaptions(post(`/api/jobs/${parent}/captions`, {}), params({ id: parent }))).json()) as JobSummary;
  expect((await settle(created.id)).state).toBe('succeeded');
  return { parent, id: created.id };
}

const startExport = (id: string, body: unknown) => postExport(post(`/api/captions/${id}/export`, body), params({ id }));

async function finished(id: string, exportId: string): Promise<CaptionExportSummary> {
  for (let i = 0; i < 300; i++) {
    const state = (await (await getExport(new Request('http://localhost/x'), params({ id, exportId }))).json()) as CaptionExportSummary;
    if (state.state !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the export did not end');
}

test('an export burns the corrected words in a 9:16 clip with its sound, the AI mention and a recipe that replays it', async () => {
  const { parent, id } = await transcribed();
  const res = await startExport(id, { text: FIXED, style: 'pop', language: 'en' });
  expect(res.status).toBe(202);
  const started = (await res.json()) as CaptionExportSummary;
  expect(started).toMatchObject({ style: 'pop', state: 'running' });
  const done = await finished(id, started.id);
  expect(done.state).toBe('succeeded');
  const clip = mediaFileFor(done.url)!;
  expect(await probe(clip)).toMatchObject({ width: 1080, height: 1920 });
  expect(await probeAudio(clip)).not.toBeNull();
  const tags = await readTags(clip);
  expect(tags.comment).toBe('AI-generated');
  const parsed = parseRecipe(JSON.parse(tags.synopsis!));
  expect(parsed.ok).toBe(true);
  const compact = (parsed as { ok: true; recipe: Recipe }).recipe;
  expect(compact.task).toBe('captions');
  expect(compact.post.at(-1)).toMatch(/^captions-9x16:pop:montagio\/captions-ass@1:fonts-[0-9a-f]{12}$/);
  expect(compact.request?.route).toBe('/api/avatars');
  // The language the transcription was asked for ("auto"), so a replay runs the same Whisper workflow.
  expect(compact.request?.then).toEqual([{ route: '/api/jobs/:parent/captions', body: { language: 'auto', export: { text: FIXED, style: 'pop' } }, files: [] }]);

  const ass = readFileSync(join(jobDir(id), 'exports', started.id, 'captions.ass'), 'utf8');
  expect(ass).toContain('MONTAGIO');
  expect(ass).not.toContain('RATE');
  // The job's result is the export now, and its recipe is the export's.
  expect((await jobs.read(id))!.outputUrl).toBe(done.url);
  const full = (await (await getRecipe(new Request('http://localhost/x'), params({ source: 'job', id }))).json()) as Recipe;
  expect(full.post.at(-1)).toBe(compact.post.at(-1));
  const info = (await (await getCaptions(new Request('http://localhost/x'), params({ id }))).json()) as CaptionsInfo;
  expect(info.exports).toEqual([expect.objectContaining({ id: started.id, state: 'succeeded', url: done.url })]);

  // The History lists it as a clip of its own, made from the avatar.
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'captions', downloadUrl: done.url, reproduces: `/api/recipes/job/${parent}` });
  expect(item!.name).toMatch(/· 9:16 captions$/);
}, 120_000);

test('two exports one after the other: two folders, the job points to the last one finished, no partial file', async () => {
  const { id } = await transcribed();
  const first = (await (await startExport(id, { text: FIXED, style: 'karaoke', language: 'en' })).json()) as CaptionExportSummary;
  const second = (await (await startExport(id, { text: FIXED, style: 'neon', language: 'en' })).json()) as CaptionExportSummary;
  expect(first.id).not.toBe(second.id);
  const [a, b] = [await finished(id, first.id), await finished(id, second.id)];
  expect([a.state, b.state]).toEqual(['succeeded', 'succeeded']);
  expect((await jobs.read(id))!.outputUrl).toBe(b.url);
  const files = readdirSync(join(jobDir(id), 'exports'), { recursive: true }).map(String);
  expect(files.filter((name) => name.endsWith('.part'))).toEqual([]);
}, 180_000);

test('an export is refused without a text, and for an unknown job', async () => {
  const { id } = await transcribed();
  const empty = await startExport(id, { text: '  ', style: 'pop', language: 'en' });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toEqual({ error: 'invalid-input' });
  expect((await startExport('nope', { text: FIXED, style: 'pop', language: 'en' })).status).toBe(404);
  expect((await getExport(new Request('http://localhost/x'), params({ id, exportId: '../../x' }))).status).toBe(404);
}, 60_000);

test('the preview is one frame of the export, 540x960, made once for the same text and style', async () => {
  const { id } = await transcribed();
  const res = await postPreview(post(`/api/captions/${id}/preview`, { text: FIXED, style: 'classic', language: 'en' }), params({ id }));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(bytes.readUInt32BE(16)).toBe(540);
  expect(bytes.readUInt32BE(20)).toBe(960);
  const again = Buffer.from(await (await postPreview(post(`/api/captions/${id}/preview`, { text: FIXED, style: 'classic', language: 'en' }), params({ id }))).arrayBuffer());
  expect(again.equals(bytes)).toBe(true);
  expect(readdirSync(join(jobDir(id), 'previews'))).toHaveLength(1);
}, 60_000);

test('a captions job asked with a text and a style (a recipe replayed) delivers the 9:16 clip at once, by the same workflows', async () => {
  const { parent, id } = await transcribed();
  const exported = (await (await startExport(id, { text: FIXED, style: 'word' })).json()) as CaptionExportSummary;
  expect((await finished(id, exported.id)).state).toBe('succeeded');
  const original = (await (await getRecipe(new Request('http://localhost/x'), params({ source: 'job', id }))).json()) as Recipe;

  // What `npm run reproduce` sends once the clip is made again: here on the same clip.
  const replay = original.request!.then![0]!;
  const created = (await (await postCaptions(post(`/api/jobs/${parent}/captions`, replay.body), params({ id: parent }))).json()) as JobSummary;
  const done = await settle(created.id);
  expect(done.state).toBe('succeeded');
  expect(done.outputUrl).toMatch(/\/exports\/[^/]+\/video\.mp4$/);
  expect(await probe(mediaFileFor(done.outputUrl)!)).toMatchObject({ width: 1080, height: 1920 });
  const again = (await (await getRecipe(new Request('http://localhost/x'), params({ source: 'job', id: created.id }))).json()) as Recipe;
  expect(sameWorkflows(original, again)).toBe(true);
  expect(again.post).toEqual(original.post);
}, 180_000);

test('the export burns the words in the language they were heard in, and refuses a listed name', async () => {
  const { id } = await transcribed();
  // A language sent with the text is not taken: the words were heard in English.
  const res = await startExport(id, { text: FIXED, style: 'classic', language: 'ja' });
  expect(res.status).toBe(202);
  const started = (await res.json()) as CaptionExportSummary;
  expect((await finished(id, started.id)).state).toBe('succeeded');
  const blocked = await startExport(id, { text: 'Hello, this is Donald Trump.', style: 'pop' });
  expect(blocked.status).toBe(400);
  expect(await blocked.json()).toEqual({ error: 'blocked-name' });
  const preview = await postPreview(post(`/api/captions/${id}/preview`, { text: 'Hello, this is Donald Trump.', style: 'pop' }), params({ id }));
  expect(preview.status).toBe(400);
}, 120_000);

test('a transcript heard in a language without captions cannot be exported, whatever language is sent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-words-'));
  writeFileSync(
    join(dir, '_default.json'),
    JSON.stringify({ schema: 'montagio/words@1', model: 'whisper-large-v3-turbo', language: 'ja', detected: true, duration_s: 1, text: ' こんにちは', chunks: [{ text: ' こんにちは', start: 0, end: 0.8 }] }),
  );
  process.env.MONTAGIO_DEMO_CAPTIONS = dir;
  resetServicesForTests();
  const parent = await talkingAvatar();
  const record = (await jobs.read(parent))!;
  record.inputs = { ...record.inputs, text: undefined };
  writeFileSync(join(jobDir(parent), 'record.json'), JSON.stringify(record));
  const created = (await (await postCaptions(post(`/api/jobs/${parent}/captions`, {}), params({ id: parent }))).json()) as JobSummary;
  expect((await settle(created.id)).state).toBe('succeeded');
  const res = await startExport(created.id, { text: 'Konnichiwa', style: 'pop', language: 'en' });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'language-unsupported' });
}, 120_000);
