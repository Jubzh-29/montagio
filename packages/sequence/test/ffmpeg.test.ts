import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_METADATA,
  concatClips,
  exportVertical,
  extractLastFrame,
  probe,
  readTags,
  SequenceToolError,
  tagClip,
} from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'montagio-seq-'));
const clipA = join(dir, 'a.mp4');
const clipB = join(dir, 'b.mp4');
const squareClip = join(dir, 'square.mp4');
const clipWithTitle = join(dir, 'titled.mp4');
const webmClip = join(dir, 'clip.webm');

// These tests run the real FFmpeg (about 0.5 s each when idle). With other ffmpeg jobs on the machine,
// one test took 14.6 s and the three fixture encodes about 17 s, past Vitest's 5 s test / 10 s hook
// defaults. The budgets below absorb that load and still fail on a hung ffmpeg.
const FFMPEG_TEST_TIMEOUT_MS = 30_000;
const FIXTURES_TIMEOUT_MS = 60_000;

function makeClip(path: string, size: string, source: string): void {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `${source}=size=${size}:rate=16`, '-t', '2', '-pix_fmt', 'yuv420p', path]);
}

beforeAll(() => {
  makeClip(clipA, '832x480', 'testsrc');
  makeClip(clipB, '832x480', 'testsrc2');
  makeClip(squareClip, '640x640', 'testsrc');
  // A render whose container carries a server path, as a pod's output could.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', clipA, '-c', 'copy', '-metadata', 'title=/pod/secret/path', clipWithTitle]);
  // What ComfyUI's SaveWEBM node produces.
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=832x480:rate=16', '-t', '1',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', webmClip,
  ]);
}, FIXTURES_TIMEOUT_MS);

afterEach(() => {
  delete process.env.MONTAGIO_FFMPEG;
});

test('extractLastFrame writes a PNG of the clip size', async () => {
  const png = join(dir, 'last.png');
  await extractLastFrame(clipA, png);
  expect(await probe(png)).toMatchObject({ width: 832, height: 480 });
}, FFMPEG_TEST_TIMEOUT_MS);

test('concat of three 2 s clips lasts about 6 s', async () => {
  const film = join(dir, 'film.mp4');
  await concatClips([clipA, clipB, clipA], film, { width: 832, height: 480 }, 16);
  const p = await probe(film);
  expect(p).toMatchObject({ width: 832, height: 480 });
  expect(p.duration_s).toBeGreaterThan(5.8);
  expect(p.duration_s).toBeLessThan(6.3);
}, FFMPEG_TEST_TIMEOUT_MS);

test('clips of different sizes are fitted to the first size', async () => {
  const film = join(dir, 'mixed.mp4');
  await concatClips([clipA, squareClip], film, { width: 832, height: 480 }, 16);
  expect(await probe(film)).toMatchObject({ width: 832, height: 480 });
}, FFMPEG_TEST_TIMEOUT_MS);

test('exportVertical produces 720x1280', async () => {
  const vertical = join(dir, 'vertical.mp4');
  await exportVertical(clipA, vertical);
  expect(await probe(vertical)).toMatchObject({ width: 720, height: 1280 });
}, FFMPEG_TEST_TIMEOUT_MS);

test('tagClip writes the AI-generated mention and drops the source tags', async () => {
  const tagged = join(dir, 'tagged.mp4');
  await tagClip(clipWithTitle, tagged);
  const tags = await readTags(tagged);
  expect(tags).toMatchObject(AI_METADATA);
  expect(tags.title).toBeUndefined();
  expect(await probe(tagged)).toMatchObject({ width: 832, height: 480 });
}, FFMPEG_TEST_TIMEOUT_MS);

test('a WebM clip is remuxed to an MP4 carrying the mention', async () => {
  const tagged = join(dir, 'tagged-from-webm.mp4');
  await tagClip(webmClip, tagged);
  expect(await readTags(tagged)).toMatchObject(AI_METADATA);
  expect(await probe(tagged)).toMatchObject({ width: 832, height: 480 });
}, FFMPEG_TEST_TIMEOUT_MS);

test('the film and the 9:16 cut carry the mention', async () => {
  const film = join(dir, 'tagged-film.mp4');
  const vertical = join(dir, 'tagged-vertical.mp4');
  await concatClips([clipWithTitle, clipB], film, { width: 832, height: 480 }, 16);
  await exportVertical(film, vertical);
  for (const file of [film, vertical]) {
    const tags = await readTags(file);
    expect(tags, file).toMatchObject(AI_METADATA);
    expect(tags.title, file).toBeUndefined();
  }
}, FFMPEG_TEST_TIMEOUT_MS);

test('a missing ffmpeg names MONTAGIO_FFMPEG', async () => {
  process.env.MONTAGIO_FFMPEG = 'ffmpeg-does-not-exist';
  const error = await extractLastFrame(clipA, join(dir, 'never.png')).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SequenceToolError);
  expect(String(error)).toMatch(/MONTAGIO_FFMPEG/);
});
