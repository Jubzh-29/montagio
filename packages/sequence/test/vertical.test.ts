import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_METADATA, captionFrame, extractSpeech, outputFps, probe, probeAudio, readTags, RECIPE_TAG, renderVertical, SequenceToolError } from '../src/index';

// Real FFmpeg, with the budgets of ffmpeg.test.ts (a loaded machine stretches each encode).
const FFMPEG_TEST_TIMEOUT_MS = 30_000;
const FIXTURES_TIMEOUT_MS = 60_000;

const dir = mkdtempSync(join(tmpdir(), 'montagio-vertical-'));
const talking = join(dir, 'talking.mp4');
const silent = join(dir, 'silent.mp4');
const captions = join(dir, 'captions');
const FONT = join(__dirname, '..', '..', '..', 'apps', 'web', 'public', 'fonts', 'captions', 'Anton-Regular.ttf');

const ASS_HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1080',
  'PlayResY: 1920',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: t,Anton,200,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,8,0,2,70,70,540,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\n');

/** The grey bytes of the band where captions sit (y 640 to 720 of a 540x960 frame). */
function band(png: string): Buffer {
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-i', png, '-vf', 'crop=540:80:0:640,format=gray', '-f', 'rawvideo', '-']);
}

beforeAll(() => {
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=832x480:rate=16',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=24000',
    '-t', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', talking,
  ]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=832x480:rate=16', '-t', '2', '-pix_fmt', 'yuv420p', silent]);
  mkdirSync(join(captions, 'fonts'), { recursive: true });
  copyFileSync(FONT, join(captions, 'fonts', 'Anton-Regular.ttf'));
  writeFileSync(join(captions, 'on.ass'), `${ASS_HEADER}\nDialogue: 0,0:00:00.00,0:00:02.00,t,,0,0,0,,TEST\n`);
  writeFileSync(join(captions, 'off.ass'), `${ASS_HEADER}\n`);
}, FIXTURES_TIMEOUT_MS);

test('outputFps doubles a low frame rate up to 24 fps or more', () => {
  expect(outputFps(16)).toBe(32);
  expect(outputFps(12)).toBe(24);
  expect(outputFps(30)).toBe(30);
  expect(outputFps(25)).toBe(25);
});

test('renderVertical makes a 1080x1920 clip at twice 16 fps, with its sound and its tags', async () => {
  const out = join(dir, 'vertical.mp4');
  await renderVertical(talking, out, { tags: { ...AI_METADATA, [RECIPE_TAG.video]: '{"seed":3}' } });
  expect(await probe(out)).toMatchObject({ width: 1080, height: 1920, fps: 32 });
  expect((await probeAudio(out))?.codec).toBe('aac');
  const tags = await readTags(out);
  expect(tags.comment).toBe('AI-generated');
  expect(tags.synopsis).toBe('{"seed":3}');
}, FFMPEG_TEST_TIMEOUT_MS);

test('renderVertical burns the captions in, and leaves no partial file', async () => {
  const out = join(dir, 'captioned.mp4');
  await renderVertical(silent, out, { captions: { dir: captions, ass: 'on.ass', fonts: 'fonts' } });
  expect(await probe(out)).toMatchObject({ width: 1080, height: 1920 });
  expect(await probeAudio(out)).toBeNull();
  expect(readdirSync(dir).filter((name) => name.endsWith('.part'))).toEqual([]);
}, FFMPEG_TEST_TIMEOUT_MS);

test('captionFrame shows the captions at their moment, in the caption band', async () => {
  const on = join(dir, 'on.png');
  const off = join(dir, 'off.png');
  await captionFrame(talking, on, { at_s: 1, captions: { dir: captions, ass: 'on.ass', fonts: 'fonts' } });
  await captionFrame(talking, off, { at_s: 1, captions: { dir: captions, ass: 'off.ass', fonts: 'fonts' } });
  expect(await probe(on)).toMatchObject({ width: 540, height: 960 });
  const [a, b] = [band(on), band(off)];
  let changed = 0;
  for (let index = 0; index < a.length; index++) if (Math.abs(a[index]! - b[index]!) > 40) changed++;
  expect(changed).toBeGreaterThan(500);
}, FFMPEG_TEST_TIMEOUT_MS);

test('a caption file name that is a path is refused before FFmpeg runs', async () => {
  const out = join(dir, 'refused.mp4');
  await expect(renderVertical(talking, out, { captions: { dir: captions, ass: 'C:/other.ass', fonts: 'fonts' } })).rejects.toBeInstanceOf(SequenceToolError);
  await expect(renderVertical(talking, out, { captions: { dir: captions, ass: 'on.ass', fonts: '../fonts' } })).rejects.toBeInstanceOf(SequenceToolError);
  expect(existsSync(out)).toBe(false);
});

test('extractSpeech writes the sound as mono FLAC at 16 kHz, and refuses a silent clip', async () => {
  const flac = join(dir, 'speech.flac');
  const { duration_s } = await extractSpeech(talking, flac);
  expect(duration_s).toBeGreaterThan(1.8);
  expect(await probeAudio(flac)).toMatchObject({ codec: 'flac', sampleRate: 16000, channels: 1 });
  await expect(extractSpeech(silent, join(dir, 'none.flac'))).rejects.toBeInstanceOf(SequenceToolError);
}, FFMPEG_TEST_TIMEOUT_MS);
