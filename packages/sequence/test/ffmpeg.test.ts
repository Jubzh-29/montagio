import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_METADATA,
  concatClips,
  concatCopy,
  decodeCheck,
  exportVertical,
  extractLastFrame,
  normalizeClip,
  placeholderClip,
  PLACEHOLDER_METADATA,
  probe,
  readTags,
  SequenceToolError,
  SHOWCASE_X264,
  tagClip,
} from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'montagio-seq-'));
const clipA = join(dir, 'a.mp4');
const clipB = join(dir, 'b.mp4');
const squareClip = join(dir, 'square.mp4');
const clipWithTitle = join(dir, 'titled.mp4');
const webmClip = join(dir, 'clip.webm');
const samplePhoto = join(dir, 'sample.png');

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
  // A sample photo at twice the 16:9 480p size, as the showcase keeps them.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1664x960', '-frames:v', '1', samplePhoto]);
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

// --- Showcase helpers: every showcase clip shares one encoding, so the browser can join them with -c copy.

const ZOOM_IN = { z: '1+0.3*on/32', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };

test('normalizeClip fits a square clip to 832x480 at 16 fps with the given tags', async () => {
  const out = join(dir, 'normalized-square.mp4');
  await normalizeClip(squareClip, out, { width: 832, height: 480, fps: 16, tags: AI_METADATA });
  const p = await probe(out);
  expect(p).toMatchObject({ width: 832, height: 480, fps: 16 });
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', out], {
    encoding: 'utf8',
  });
  expect(streams.trim().split(/\s+/)).toEqual(['h264,video']);
  expect(await readTags(out)).toMatchObject(AI_METADATA);
}, FFMPEG_TEST_TIMEOUT_MS);

test('placeholderClip writes the asked frames and the placeholder tags', async () => {
  const out = join(dir, 'placeholder.mp4');
  await placeholderClip(samplePhoto, out, { width: 832, height: 480, fps: 16, frames: 33, motion: ZOOM_IN, tags: PLACEHOLDER_METADATA });
  const p = await probe(out);
  expect(p).toMatchObject({ width: 832, height: 480, fps: 16 });
  expect(p.duration_s).toBeCloseTo(33 / 16, 1);
  const tags = await readTags(out);
  expect(tags).toMatchObject(PLACEHOLDER_METADATA);
  expect(JSON.stringify(tags)).not.toMatch(/AI-generated/);
}, FFMPEG_TEST_TIMEOUT_MS);

test('exportVertical takes the showcase encoder and tags', async () => {
  const out = join(dir, 'vertical-showcase.mp4');
  await exportVertical(clipA, out, { encoder: SHOWCASE_X264, tags: PLACEHOLDER_METADATA });
  expect(await probe(out)).toMatchObject({ width: 720, height: 1280, fps: 16 });
  expect(await readTags(out)).toMatchObject(PLACEHOLDER_METADATA);
}, FFMPEG_TEST_TIMEOUT_MS);

test('concatCopy joins a normalized clip and a placeholder without re-encoding', async () => {
  const normalized = join(dir, 'concat-normalized.mp4');
  const placeholder = join(dir, 'concat-placeholder.mp4');
  const film = join(dir, 'concat-film.mp4');
  await normalizeClip(clipA, normalized, { width: 832, height: 480, fps: 16, tags: AI_METADATA });
  await placeholderClip(samplePhoto, placeholder, { width: 832, height: 480, fps: 16, frames: 33, motion: ZOOM_IN, tags: PLACEHOLDER_METADATA });
  await concatCopy([normalized, placeholder], film, PLACEHOLDER_METADATA);
  const [a, b, joined] = await Promise.all([probe(normalized), probe(placeholder), probe(film)]);
  expect(joined.duration_s).toBeGreaterThan(a.duration_s + b.duration_s - 0.1);
  expect(joined.duration_s).toBeLessThan(a.duration_s + b.duration_s + 0.1);
  await decodeCheck(film);
  expect(await readTags(film)).toMatchObject(PLACEHOLDER_METADATA);
}, FFMPEG_TEST_TIMEOUT_MS);

test('decodeCheck rejects a truncated clip', async () => {
  // Without +faststart the index (moov) sits at the end: cutting the file loses it.
  const whole = join(dir, 'no-faststart.mp4');
  const truncated = join(dir, 'truncated.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', clipA, '-c', 'copy', whole]);
  const bytes = readFileSync(whole);
  writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length * 0.6)));
  await expect(decodeCheck(truncated)).rejects.toBeInstanceOf(SequenceToolError);
  await expect(decodeCheck(whole)).resolves.toBeUndefined();
}, FFMPEG_TEST_TIMEOUT_MS);
