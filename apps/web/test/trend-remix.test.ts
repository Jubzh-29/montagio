import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Recipe } from '@montagio/recipe';
import { countFrames, probe, probeAudio, readTags } from '@montagio/sequence';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { GET as getRecipe } from '@/app/api/recipes/[source]/[id]/route';
import { GET as getImport, POST as postImport } from '@/app/api/remix/import/route';
import { POST as postRemix } from '@/app/api/remix/route';
import { POST as postShots } from '@/app/api/remix/shots/route';
import { POST as postSkeleton } from '@/app/api/remix/skeleton/route';
import { POST as postTrend } from '@/app/api/uploads/remix/route';
import { POST as postTrendSample } from '@/app/api/uploads/remix/sample/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { ExtensionsInfo, JobSummary } from '@/lib/api-types';
import { publishToCommunity } from '@/server/community';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { readJobSteps } from '@/server/jobs';
import { checkImportLink, downloadLink, importLink, LinkImportError, soundOf, type YtDlpRun } from '@/server/link-import';
import { params, setupTempData } from './helpers';

setupTempData();
let flag: string | undefined;
const scratch = mkdtempSync(join(tmpdir(), 'montagio-remix-'));
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A phone-like trend: 1 s of red, 1.5 s of blue, 1 s of green at 60 fps, 720x1280, with a tone. */
const trendFile = join(scratch, 'trend.mp4');
/** One long shot of 7 s: too long to be made again in its own scene. */
const longFile = join(scratch, 'long.mp4');
beforeAll(() => {
  const scene = (colour: string, seconds: number) => `color=c=${colour}:s=720x1280:r=60:d=${seconds}`;
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', scene('red', 1),
    '-f', 'lavfi', '-i', scene('blue', 1.5),
    '-f', 'lavfi', '-i', scene('green', 1),
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', trendFile,
  ]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=7', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', longFile]);
}, 60_000);

type TrendSummary = { remixRef: string; fps: number; frames: number; audio: boolean; origin: string; cuts: number[]; url: string; shots: { start: number; end: number; thumbUrl: string }[]; link?: { url: string; host: string }; sound?: { title: string; artists: string[]; searchUrl: string } };

const send = async (path: string) => {
  const form = new FormData();
  form.set('video', new File([readFileSync(path)], 'trend.mp4', { type: 'video/mp4' }));
  const res = await postTrend(new Request('http://localhost/api/uploads/remix', { method: 'POST', body: form }));
  expect(res.status).toBe(201);
  return (await res.json()) as TrendSummary;
};

const json = (route: string, body: unknown, key?: string) =>
  new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 40; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('the remix did not settle');
}

const characterRef = async () => ((await (await postSampleUpload(new Request('http://localhost/api/uploads/sample?for=motion', { method: 'POST' }))).json()) as { imageRef: string }).imageRef;

describe('the trend: sent, cut into shots, the cuts moved', () => {
  test('a trend sent keeps 30 fps, its sound aside, and the shots FFmpeg found, each with its first frame', async () => {
    const trend = await send(trendFile);
    expect(trend).toMatchObject({ fps: 30, frames: 105, audio: true, origin: 'upload', cuts: [30, 75] });
    expect(trend.shots.map(({ start, end }) => [start, end])).toEqual([[0, 30], [30, 75], [75, 105]]);
    for (const shot of trend.shots) expect(mediaFileFor(shot.thumbUrl)).toBeTruthy();
    const moved = await postShots(json('/api/remix/shots', { remixRef: trend.remixRef, cuts: [45] }));
    expect(((await moved.json()) as TrendSummary).shots.map(({ start, end }) => [start, end])).toEqual([[0, 45], [45, 105]]);
    for (const cuts of [[0], [105], [1.5], 'here', Array.from({ length: 16 }, (_, i) => i + 1)]) {
      expect((await postShots(json('/api/remix/shots', { remixRef: trend.remixRef, cuts }))).status).toBe(400);
    }
    expect((await postShots(json('/api/remix/shots', { remixRef: 'remix/../../x.mp4', cuts: [] }))).status).toBe(404);
  }, 120_000);

  test('another site can neither send a trend nor ask for the sample', async () => {
    const form = new FormData();
    form.set('video', new File([readFileSync(trendFile)], 'trend.mp4', { type: 'video/mp4' }));
    const sent = await postTrend(new Request('http://localhost/api/uploads/remix', { method: 'POST', body: form, headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(sent.status).toBe(403);
    const sample = await postTrendSample(new Request('http://localhost/api/uploads/remix/sample', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }));
    expect(sample.status).toBe(403);
  });

  test('the sample: three moves of the Motion library, 2 s each, cut where they were joined', async () => {
    const res = await postTrendSample(json('/api/uploads/remix/sample', {}));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ origin: 'sample', fps: 16, frames: 96, cuts: [32, 64], audio: false });
  }, 120_000);

  test('hidden with its extension, or the motion it needs', async () => {
    process.env.MONTAGIO_EXTENSIONS = 'avatar';
    expect((await postTrendSample(json('/api/uploads/remix/sample', {}))).status).toBe(404);
    const info = (await (await getExtensions()).json()) as ExtensionsInfo;
    expect(info.remix).toBeUndefined();
    process.env.MONTAGIO_EXTENSIONS = 'all';
    const all = (await (await getExtensions()).json()) as ExtensionsInfo;
    expect(all.remix).toMatchObject({ scene: true, skeleton: { model: { id: 'gemma4-trend-skeleton' } } });
  });
});

describe('the remix', () => {
  test('the rights, the face box, a known photo and shots it can make are required', async () => {
    const trend = await send(trendFile);
    const imageRef = await characterRef();
    const base = { remixRef: trend.remixRef, imageRef, rights: true, faceConsent: true };
    const answer = async (body: unknown, key: string) => (await postRemix(json('/api/remix', body, key))).json();
    expect(await answer({ ...base, rights: undefined }, 'r1')).toEqual({ error: 'rights-required' });
    // The face box is ticked each time, whatever the photo: never deduced from a file sent.
    expect(await answer({ ...base, faceConsent: undefined }, 'r2')).toEqual({ error: 'consent-required' });
    expect(await answer({ ...base, imageRef: 'uploads/nope.png' }, 'r3')).toEqual({ error: 'unknown-image' });
    expect(await answer({ ...base, imageRef: undefined }, 'r4')).toEqual({ error: 'unknown-image' });
    expect(await answer({ ...base, keepSound: true }, 'r5')).toEqual({ error: 'rights-required' });
    expect(await answer({ ...base, language: 'de' }, 'r6')).toEqual({ error: 'language-unsupported' });
    const invalid = [
      { ...base, mode: 'dance' },
      { ...base, remixRef: 'remix/nope.mp4' },
      { ...base, shots: [{ keep: true }, { keep: true }, { keep: true }] },
      { ...base, shots: [{ keep: false }] },
      { ...base, onscreen: 'x'.repeat(121) },
      // In its own scene, a shot made again needs its points.
      { ...base, mode: 'scene', prompt: 'a red cap', shots: [{ keep: false }, { keep: true }, { keep: true }] },
      { ...base, mode: 'scene', shots: [{ keep: false, points: [{ x: 0.5, y: 0.5 }] }, { keep: true }, { keep: true }] },
    ];
    for (const [i, body] of invalid.entries()) expect({ i, answer: await answer(body, `r7-${i}`) }).toEqual({ i, answer: { error: 'invalid-input' } });
    const long = await send(longFile);
    expect(await answer({ ...base, remixRef: long.remixRef, mode: 'scene', prompt: 'a red cap', shots: [{ keep: false, points: [{ x: 0.5, y: 0.5 }] }] }, 'r8')).toEqual({ error: 'shot-too-long' });
  }, 120_000);

  test('every shot made again on the same seed, put back on the trend frames, silent, then cut to 9:16', async () => {
    const trend = await send(trendFile);
    const imageRef = await characterRef();
    const res = await postRemix(json('/api/remix', { remixRef: trend.remixRef, imageRef, rights: true, faceConsent: true, character: 'a cartoon boy', onscreen: 'POV: monday', language: 'en', post: { caption: 'Monday.', hashtags: ['#remix', 'Remix'] } }, 'r9'));
    expect(res.status).toBe(201);
    const created = (await res.json()) as JobSummary;
    expect(created).toMatchObject({ task: 'remix', modelId: 'wan-animate2-motion' });
    const done = await poll(created.id);
    expect(done.state).toBe('succeeded');
    const clip = mediaFileFor(done.outputUrl)!;
    expect(await countFrames(clip)).toBe(105);
    expect((await probe(clip)).fps).toBe(30);
    expect(await probeAudio(clip)).toBeNull();
    expect((await readTags(clip)).comment).toBe('AI-generated');
    const vertical = mediaFileFor(done.verticalUrl)!;
    expect(await probe(vertical)).toMatchObject({ width: 1080, height: 1920 });
    const { record, steps } = (await readJobSteps(created.id))!;
    expect(steps.map((step) => step.name)).toEqual(['shot 1', 'shot 2', 'shot 3']);
    for (const step of steps) expect(JSON.stringify(step.workflow)).toContain(String(record.seed));
    expect(record.inputs).toMatchObject({ post: { caption: 'Monday.', hashtags: ['remix'] }, faceConsentAt: expect.any(String) });
    // Reuse reopens the Remix page; the recipe replays the trend by its file, never its sound.
    const item = (await listHistory()).find((entry) => entry.key === `job:${created.id}`)!;
    expect(item).toMatchObject({ kind: 'clip', task: 'remix', downloadUrl: done.verticalUrl, reprise: { tab: 'remix', remixRef: trend.remixRef, remix: { origin: 'upload', mode: 'motion', cuts: [30, 75], onscreen: 'POV: monday' } } });
    const recipe = (await (await getRecipe(new Request(`http://localhost/api/recipes/job/${created.id}`), params({ source: 'job', id: created.id }))).json()) as Recipe;
    expect(recipe.request).toMatchObject({ route: '/api/remix', body: { mode: 'motion', cuts: [30, 75], seed: record.seed } });
    expect(recipe.request!.files.map((file) => file.field)).toEqual(['remixRef', 'imageRef']);
    expect(JSON.stringify(recipe)).not.toContain('keepSound":true');
    expect(recipe.post).toEqual(['assemble-shots', 'onscreen-text', 'vertical', 'tag']);
    // Someone else's trend stays with the user.
    await expect(publishToCommunity({ historyKey: item.key, title: 'mine' })).rejects.toMatchObject({ code: 'rights-required' });
  }, 180_000);

  test("a shot kept as filmed is cut from the trend; the trend's sound only with the user's word", async () => {
    const trend = await send(trendFile);
    const imageRef = await characterRef();
    const body = { remixRef: trend.remixRef, imageRef, rights: true, faceConsent: true, shots: [{ keep: true }, { keep: false }, { keep: true }], keepSound: true, soundRights: true };
    const created = (await (await postRemix(json('/api/remix', body, 'r10'))).json()) as JobSummary;
    const done = await poll(created.id);
    expect(done.state).toBe('succeeded');
    const clip = mediaFileFor(done.outputUrl)!;
    expect(await countFrames(clip)).toBe(105);
    expect(await probeAudio(clip)).not.toBeNull();
    expect((await readJobSteps(created.id))!.steps.map((step) => step.name)).toEqual(['shot 2']);
  }, 180_000);

  test('in its own scene: the points of each shot made again go to the tracker', async () => {
    const trend = await send(trendFile);
    const shots = [{ keep: false, points: [{ x: 0.5, y: 0.5 }] }, { keep: true }, { keep: false, points: [{ x: 0.25, y: 0.75 }], exclude: [{ x: 0.9, y: 0.1 }] }];
    const created = (await (await postRemix(json('/api/remix', { remixRef: trend.remixRef, mode: 'scene', prompt: 'a red cap', shots, rights: true }, 'r11'))).json()) as JobSummary;
    expect(created).toMatchObject({ modelId: 'wan21-vace-swap' });
    expect((await poll(created.id)).state).toBe('succeeded');
    const { steps } = (await readJobSteps(created.id))!;
    expect(steps.map((step) => step.name)).toEqual(['shot 1', 'shot 3']);
    expect(JSON.parse(String(steps[1]!.workflow['41']!.inputs.coordinates_negative))).toHaveLength(1);
  }, 180_000);

  test("the skeleton: Gemma reads one sheet of the shots' first frames and writes the post", async () => {
    const trend = await send(trendFile);
    const res = await postSkeleton(json('/api/remix/skeleton', { remixRef: trend.remixRef, character: 'a cartoon boy', language: 'fr' }, 's1'));
    expect(res.status).toBe(201);
    const created = (await res.json()) as JobSummary;
    expect(created).toMatchObject({ task: 'remix-skeleton', modelId: 'gemma4-trend-skeleton' });
    const done = await poll(created.id);
    expect(done.state).toBe('succeeded');
    const doc = JSON.parse(await readFile(mediaFileFor(done.outputUrl)!, 'utf8')) as { skeleton: { shots: string[] }; post: { hashtags: string[] }; language: string };
    expect(doc.skeleton.shots).toHaveLength(3);
    expect(doc.post.hashtags).toContain('remix');
    expect(doc.language).toBe('fr');
    const { steps } = (await readJobSteps(created.id))!;
    expect(steps[0]!.workflow['4']!.inputs.string_a).toMatch(/in which a cartoon boy performs the same shots/);
    // A transcription-like result: not an item of the history.
    expect((await listHistory()).some((entry) => entry.key === `job:${created.id}`)).toBe(false);
  }, 120_000);
});

describe('the import by link: on a machine of its own only, yt-dlp simulated (never the network)', () => {
  test('only the listed platforms, by name, over http(s), without user nor port', () => {
    const ok = [
      'https://www.tiktok.com/@someone/video/7400000000000000000',
      'https://vm.tiktok.com/ZMabc123/',
      'https://www.instagram.com/reel/C1abc-_2/',
      'https://youtube.com/shorts/abcDEF12345',
      'https://youtu.be/abcDEF12345#t=3',
    ];
    for (const url of ok) expect(checkImportLink(url)).toMatchObject({ ok: true });
    expect(checkImportLink('https://youtu.be/abcDEF12345#t=3')).toMatchObject({ url: 'https://youtu.be/abcDEF12345' });
    const refused: [string, string][] = [
      ['http://127.0.0.1:3000/api/history', 'link-invalid'],
      ['http://localhost/media/data/x.mp4', 'link-host'],
      ['http://192.168.1.1/', 'link-host'],
      ['http://[::1]/', 'link-host'],
      ['http://0x7f000001/', 'link-host'],
      ['https://tiktok.com.evil.example/video/1', 'link-host'],
      ['https://evil.example/?u=https://www.tiktok.com/', 'link-host'],
      ['https://user:pass@www.tiktok.com/@a/video/1', 'link-invalid'],
      ['https://www.tiktok.com:8443/@a/video/1', 'link-invalid'],
      ['file:///etc/passwd', 'link-invalid'],
      ['ftp://www.tiktok.com/x', 'link-invalid'],
      ['https://www.youtube.com/watch?v=abcDEF12345', 'link-path'],
      ['https://www.instagram.com/someone/', 'link-path'],
      ['not a link', 'link-invalid'],
    ];
    for (const [url, reason] of refused) expect({ url, check: checkImportLink(url) }).toEqual({ url, check: { ok: false, reason } });
  });

  test("the sound its platform names: its title, its artists, a search for it there", () => {
    expect(soundOf({ track: 'Song', artists: ['A', 'B'] }, 'tiktok')).toEqual({ title: 'Song', artists: ['A', 'B'], searchUrl: 'https://www.tiktok.com/search?q=Song%20A%20B' });
    expect(soundOf({ track: 'Song', artist: 'A, B' }, 'youtube')!.artists).toEqual(['A', 'B']);
    expect(soundOf({}, 'instagram')).toBeUndefined();
  });

  /** A yt-dlp that writes what a download would, from a local file, and notes what it was asked. */
  function fakeYtDlp(info: Record<string, unknown> | null, calls: string[][]): YtDlpRun {
    return async (_bin, args) => {
      calls.push(args);
      const out = args[args.indexOf('-o') + 1]!;
      if (info) {
        copyFileSync(trendFile, out.replace('%(ext)s', 'mp4'));
        writeFileSync(out.replace('%(ext)s', 'info.json'), JSON.stringify(info));
      }
      return '';
    };
  }

  test('a link imported: its own configuration ignored, 60 s and 50 MB at most, the link and the sound kept beside it', async () => {
    const calls: string[][] = [];
    const meta = await importLink('https://www.tiktok.com/@a/video/1', fakeYtDlp({ duration: 3.5, track: 'Song', artists: ['A'] }, calls));
    expect(meta).toMatchObject({ origin: 'link', frames: 105, cuts: [30, 75], link: { url: 'https://www.tiktok.com/@a/video/1', host: 'www.tiktok.com' }, sound: { title: 'Song' } });
    const args = calls[0]!;
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--no-playlist', '--max-filesize', '50M', '--match-filters', 'duration <= 60']));
    // The link comes last, after "--": never read as an option.
    expect(args.slice(-2)).toEqual(['--', 'https://www.tiktok.com/@a/video/1']);
  }, 60_000);

  test('a refused link starts nothing; too long, or nothing written, is said so', async () => {
    const calls: string[][] = [];
    await expect(importLink('http://169.254.169.254/latest/meta-data', fakeYtDlp({}, calls))).rejects.toMatchObject({ code: 'link-host' });
    expect(calls).toEqual([]);
    const dir = mkdtempSync(join(scratch, 'dl-'));
    await expect(downloadLink('https://youtu.be/abc', dir, fakeYtDlp(null, calls))).rejects.toBeInstanceOf(LinkImportError);
    await expect(importLink('https://youtu.be/abc', fakeYtDlp({ duration: 90 }, calls))).rejects.toMatchObject({ code: 'link-too-long' });
  }, 60_000);

  test('the demo has neither the route nor the field', async () => {
    expect((await getImport()).status).toBe(404);
    const res = await postImport(json('/api/remix/import', { url: 'https://www.tiktok.com/@a/video/1', rights: true }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });
});
