import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleShots,
  countFrames,
  cutShot,
  detectShots,
  framesAt,
  prepareRemixSource,
  probe,
  probeAudio,
  readTags,
  remixFps,
  shotRanges,
  shotSheet,
} from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'montagio-shots-'));
/** A phone-like trend: 1 s of red, 1.5 s of blue, 1 s of green at 60 fps, 720x1280, with a tone. */
const trend = join(dir, 'trend.mp4');
const source = join(dir, 'source.mp4');

// Real FFmpeg runs, as in ffmpeg.test.ts: the budgets absorb a loaded machine.
const FFMPEG_TEST_TIMEOUT_MS = 30_000;
const FIXTURES_TIMEOUT_MS = 60_000;

beforeAll(() => {
  const scene = (colour: string, seconds: number) => `color=c=${colour}:s=720x1280:r=60:d=${seconds}`;
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', scene('red', 1),
    '-f', 'lavfi', '-i', scene('blue', 1.5),
    '-f', 'lavfi', '-i', scene('green', 1),
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+48.8566+002.3522/', trend,
  ]);
}, FIXTURES_TIMEOUT_MS);

test('a source above 30 fps is kept at a whole fraction of its rate, at most 30', () => {
  expect([remixFps(60), remixFps(59.94), remixFps(50), remixFps(30), remixFps(25), remixFps(24), remixFps(0)]).toEqual([30, 29.97, 25, 30, 25, 24, 30]);
});

test('a remix source keeps its sound and drops what the phone wrote, at 30 fps with its exact frame count', async () => {
  const prepared = await prepareRemixSource(trend, source);
  expect(prepared).toMatchObject({ fps: 30, width: 720, height: 1280, audio: true });
  expect(prepared.frames).toBe(105);
  expect(await countFrames(source)).toBe(105);
  expect(await probeAudio(source)).not.toBeNull();
  expect(await readTags(source)).not.toHaveProperty('location');
}, FFMPEG_TEST_TIMEOUT_MS);

test('the scene filter finds the two cuts, on the frames where the colour changes', async () => {
  const { cuts, fps, frames } = await detectShots(source);
  expect({ fps, frames }).toEqual({ fps: 30, frames: 105 });
  expect(cuts).toEqual([30, 75]);
  expect(shotRanges(cuts, frames)).toEqual([
    { start: 0, end: 30 },
    { start: 30, end: 75 },
    { start: 75, end: 105 },
  ]);
}, FFMPEG_TEST_TIMEOUT_MS);

test('cuts closer than the shortest shot, or a cut moved by hand, give clean ranges', () => {
  expect(shotRanges([75, 30, 30, 0, 200], 105)).toEqual([
    { start: 0, end: 30 },
    { start: 30, end: 75 },
    { start: 75, end: 105 },
  ]);
  expect(shotRanges([], 105)).toEqual([{ start: 0, end: 105 }]);
});

test('a shot is cut on its frames, silent; a shot under 1 s is padded with its last frame', async () => {
  const long = join(dir, 'shot-1.mp4');
  expect(await cutShot(source, long, { start: 30, end: 75, fps: 30 })).toEqual({ frames: 45 });
  expect(await countFrames(long)).toBe(45);
  expect(await probeAudio(long)).toBeNull();
  const short = join(dir, 'shot-short.mp4');
  expect(await cutShot(source, short, { start: 0, end: 12, fps: 30 })).toEqual({ frames: 30 });
  expect(await countFrames(short)).toBe(30);
}, FFMPEG_TEST_TIMEOUT_MS);

test('the first frame of each shot, then a sheet of them in reading order', async () => {
  const frames = await framesAt(source, [0, 30, 75], (index) => join(dir, `first-${index}.png`));
  expect(frames).toHaveLength(3);
  for (const frame of frames) expect(await probe(frame)).toMatchObject({ width: 720, height: 1280 });
  const sheet = join(dir, 'sheet.png');
  expect(await shotSheet(frames, sheet, { aspect: 720 / 1280 })).toEqual({ width: 768, height: 456 });
  expect(await probe(sheet)).toMatchObject({ width: 768, height: 456 });
  const two = await shotSheet([...frames, ...frames], join(dir, 'sheet-6.png'), { aspect: 720 / 1280 });
  expect(two).toEqual({ width: 1024, height: 912 });
}, FFMPEG_TEST_TIMEOUT_MS);

test("the remix is put back on the source's frames: each shot retimed and cut to its count, the source's sound under it", async () => {
  // Three rendered shots as a video model gives them: 16 fps, 480x832, longer than the shots they replace.
  const renders = ['yellow', 'purple', 'white'].map((colour, index) => {
    const path = join(dir, `render-${index}.mp4`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=480x832:r=16:d=3.1`, '-pix_fmt', 'yuv420p', path]);
    return path;
  });
  const out = join(dir, 'remix.mp4');
  expect(await assembleShots(renders, out, { frames: [30, 45, 30], fps: 30, width: 720, height: 1280, audioFrom: source })).toEqual({ frames: 105 });
  expect(await countFrames(out)).toBe(105);
  expect(await probe(out)).toMatchObject({ width: 720, height: 1280, fps: 30 });
  expect(await probeAudio(out)).not.toBeNull();
  expect((await readTags(out)).comment).toBe('AI-generated');
  // the cuts fall where they fell: the scene filter finds them on the same frames
  expect((await detectShots(out)).cuts).toEqual([30, 75]);
  // without the source's sound, none
  const silent = join(dir, 'remix-silent.mp4');
  await assembleShots(renders, silent, { frames: [30, 45, 30], fps: 30, width: 720, height: 1280 });
  expect(await probeAudio(silent)).toBeNull();
  expect(await countFrames(silent)).toBe(105);
}, FFMPEG_TEST_TIMEOUT_MS);
