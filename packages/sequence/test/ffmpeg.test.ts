import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_METADATA,
  concatClips,
  concatCopy,
  decodeCheck,
  exportVertical,
  extractFirstFrame,
  extractLastFrame,
  headerHash,
  mixMusic,
  normalizeClip,
  overlayImage,
  placeholderClip,
  PLACEHOLDER_METADATA,
  posterFrame,
  prepareMotionClip,
  prepareSpeechVideo,
  previewClip,
  probe,
  probeAudio,
  readTags,
  replaceAudio,
  SequenceToolError,
  SHOWCASE_COLOUR,
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

test('extractFirstFrame writes a PNG of the clip size', async () => {
  const png = join(dir, 'first.png');
  await extractFirstFrame(clipA, png);
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
  await exportVertical(clipA, out, { encoder: SHOWCASE_X264, colour: SHOWCASE_COLOUR, tags: PLACEHOLDER_METADATA });
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

test('probe names the codec and the pixel format', async () => {
  expect(await probe(clipA)).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p' });
}, FFMPEG_TEST_TIMEOUT_MS);

test('previewClip writes a small looping copy at the asked width with the tags', async () => {
  const out = join(dir, 'preview.mp4');
  await previewClip(clipA, out, { width: 320, tags: PLACEHOLDER_METADATA });
  const p = await probe(out);
  expect(p).toMatchObject({ width: 320, height: 184, codec: 'h264', pixFmt: 'yuv420p' });
  expect(p.duration_s).toBeCloseTo(2, 1);
  expect(await readTags(out)).toMatchObject(PLACEHOLDER_METADATA);
}, FFMPEG_TEST_TIMEOUT_MS);

test('posterFrame writes the first frame as a small JPEG that says it is AI-generated', async () => {
  const out = join(dir, 'poster.jpg');
  await posterFrame(clipA, out, { width: 240, comment: AI_METADATA.comment });
  const p = await probe(out);
  expect(p).toMatchObject({ width: 240, codec: 'mjpeg' });
  const bytes = readFileSync(out);
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  // A JPEG comment segment (COM, FF FE) right after the start marker, holding the mention.
  expect([bytes[2], bytes[3]]).toEqual([0xff, 0xfe]);
  expect(bytes.subarray(6, 6 + AI_METADATA.comment.length).toString('utf8')).toBe(AI_METADATA.comment);
}, FFMPEG_TEST_TIMEOUT_MS);

test('a placeholder made from a JPEG and a normalized render share their H.264 headers', async () => {
  // A JPEG decodes to full-range YUV; a render is limited range. Joined with -c copy, the
  // film keeps the first clip's headers: every showcase clip must carry the same ones.
  const jpeg = join(dir, 'sample.jpg');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1664x960', '-frames:v', '1', jpeg]);
  const placeholder = join(dir, 'headers-placeholder.mp4');
  const normalized = join(dir, 'headers-normalized.mp4');
  await placeholderClip(jpeg, placeholder, { width: 832, height: 480, fps: 16, frames: 17, motion: ZOOM_IN, tags: PLACEHOLDER_METADATA });
  await normalizeClip(clipA, normalized, { width: 832, height: 480, fps: 16, tags: AI_METADATA });
  expect(await headerHash(placeholder)).toBe(await headerHash(normalized));
  const vertical = join(dir, 'headers-vertical.mp4');
  const verticalOfRender = join(dir, 'headers-vertical-render.mp4');
  await exportVertical(placeholder, vertical, { encoder: SHOWCASE_X264, colour: SHOWCASE_COLOUR, tags: PLACEHOLDER_METADATA });
  await exportVertical(normalized, verticalOfRender, { encoder: SHOWCASE_X264, colour: SHOWCASE_COLOUR, tags: AI_METADATA });
  expect(await headerHash(vertical)).toBe(await headerHash(verticalOfRender));
  expect(await probe(placeholder)).toMatchObject({ pixFmt: 'yuv420p' });
}, FFMPEG_TEST_TIMEOUT_MS);

// --- Film music: the soundtrack goes under the film, which keeps its exact length and frames.

const music5 = join(dir, 'music-5s.flac');
const music1 = join(dir, 'music-1s.flac');
const music5mp3 = join(dir, 'music-5s.mp3');

/** Duration and frame count of a file's first video and audio streams, as ffprobe reads them. */
function streamsOf(media: string): { video: { duration: number; frames: number } | null; audio: { duration: number } | null } {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_type,duration,nb_read_frames',
    '-of', 'json', media,
  ]).toString();
  const streams = (JSON.parse(out) as { streams: { codec_type: string; duration?: string; nb_read_frames?: string }[] }).streams;
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    video: video ? { duration: Number(video.duration), frames: Number(video.nb_read_frames) } : null,
    audio: audio ? { duration: Number(audio.duration) } : null,
  };
}

test.each<[string, { gainDb?: number; fadeOut_s?: number }, RegExp]>([
  ['gainDb NaN', { gainDb: Number.NaN }, /gainDb NaN is not a number of decibels/],
  ['gainDb Infinity', { gainDb: Number.POSITIVE_INFINITY }, /gainDb Infinity is not a number of decibels/],
  ['fadeOut_s -1', { fadeOut_s: -1 }, /fadeOut_s -1 is not a number of seconds above 0/],
  ['fadeOut_s 0', { fadeOut_s: 0 }, /fadeOut_s 0 is not a number of seconds above 0/],
  ['fadeOut_s NaN', { fadeOut_s: Number.NaN }, /fadeOut_s NaN is not a number of seconds above 0/],
])('mixMusic refuses %s before FFmpeg runs', async (_case, opts, message) => {
  const mix = () => mixMusic(join(dir, 'no-film.mp4'), join(dir, 'no-music.flac'), join(dir, 'never.mp4'), opts);
  await expect(mix()).rejects.toThrow(SequenceToolError);
  await expect(mix()).rejects.toThrow(message);
});

describe('mixMusic and the 9:16 cut with music', () => {
  beforeAll(() => {
    for (const [out, seconds] of [[music5, 5], [music1, 1]] as const) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=44100`, '-ac', '2', out]);
    }
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-c:a', 'libmp3lame', music5mp3]);
  }, FIXTURES_TIMEOUT_MS);

  test('mixMusic keeps every frame and the exact duration of the film when the music is longer', async () => {
    const out = join(dir, 'mixed-long.mp4');
    await mixMusic(clipA, music5, out);
    const film = streamsOf(clipA).video!;
    const mixed = streamsOf(out);
    expect(mixed.video!.frames).toBe(film.frames);
    expect(Math.abs(mixed.video!.duration - film.duration)).toBeLessThan(0.01);
    expect(Math.abs(mixed.audio!.duration - film.duration)).toBeLessThan(0.05);
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('mixMusic pads a shorter music with silence', async () => {
    const out = join(dir, 'mixed-short.mp4');
    await mixMusic(clipA, music1, out);
    const mixed = streamsOf(out);
    expect(Math.abs(mixed.audio!.duration - mixed.video!.duration)).toBeLessThan(0.05);
    expect(mixed.video!.frames).toBe(streamsOf(clipA).video!.frames);
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('mixMusic does not re-encode the video', async () => {
    const out = join(dir, 'mixed-copy.mp4');
    await mixMusic(clipA, music5, out);
    expect(await headerHash(out)).toBe(await headerHash(clipA));
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('the mixed film carries the AI-generated mention and an AAC 48 kHz stereo track', async () => {
    const out = join(dir, 'mixed-tags.mp4');
    await mixMusic(clipWithTitle, music5, out);
    const tags = await readTags(out);
    expect(tags).toMatchObject(AI_METADATA);
    expect(tags.title).toBeUndefined();
    expect(await probeAudio(out)).toMatchObject({ codec: 'aac', sampleRate: 48000, channels: 2 });
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('mixMusic reads an MP3 as well as a FLAC', async () => {
    const out = join(dir, 'mixed-mp3.mp4');
    await mixMusic(clipA, music5mp3, out);
    expect(Math.abs(streamsOf(out).audio!.duration - streamsOf(clipA).video!.duration)).toBeLessThan(0.05);
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('the 9:16 cut of a film with music keeps the music', async () => {
    const mixed = join(dir, 'mixed-for-vertical.mp4');
    const vertical = join(dir, 'mixed-vertical.mp4');
    await mixMusic(clipA, music5, mixed);
    await exportVertical(mixed, vertical);
    expect(await probe(vertical)).toMatchObject({ width: 720, height: 1280 });
    const audio = await probeAudio(vertical);
    expect(audio).toMatchObject({ codec: 'aac', channels: 2 });
    expect(Math.abs(audio!.duration_s - streamsOf(vertical).video!.duration)).toBeLessThan(0.05);
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('the 9:16 cut of a silent film has no audio stream', async () => {
    const vertical = join(dir, 'silent-vertical.mp4');
    await exportVertical(clipA, vertical);
    expect(await probeAudio(vertical)).toBeNull();
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('probeAudio is null for a silent clip', async () => {
    expect(await probeAudio(clipA)).toBeNull();
  }, FFMPEG_TEST_TIMEOUT_MS);
});

describe('prepareMotionClip and what the clip sent carries', () => {
  // A phone writes where it filmed into the clip: it must not reach ComfyUI.
  const phoneClip = join(dir, 'phone.mov');

  beforeAll(() => {
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '1',
      '-metadata', 'location=+48.8566+002.3522/', '-pix_fmt', 'yuv420p', phoneClip,
    ]);
  }, FIXTURES_TIMEOUT_MS);

  test('the prepared clip drops the location of the clip sent', async () => {
    expect(await readTags(phoneClip)).toMatchObject({ location: '+48.8566+002.3522/' });
    const prepared = join(dir, 'motion.mp4');
    await prepareMotionClip(phoneClip, prepared);
    expect(Object.keys(await readTags(prepared)).filter((key) => key.startsWith('location'))).toEqual([]);
  }, FFMPEG_TEST_TIMEOUT_MS);

  test('a URL given as the clip is never fetched: local files only', async () => {
    let requests = 0;
    const server = createServer((_, res) => {
      requests += 1;
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      await expect(prepareMotionClip(`http://127.0.0.1:${port}/clip.mp4`, join(dir, 'remote.mp4'))).rejects.toThrow(SequenceToolError);
      expect(requests).toBe(0);
    } finally {
      await new Promise((done) => server.close(done));
    }
  }, FFMPEG_TEST_TIMEOUT_MS);
});

test('an image laid over a 9:16 clip keeps its size, its sound and the AI mention', async () => {
  const vertical = join(dir, 'over-src.mp4');
  const png = join(dir, 'tagline.png');
  const out = join(dir, 'over.mp4');
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=16', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '1', '-pix_fmt', 'yuv420p', '-shortest', vertical,
  ]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white@0.5:s=360x640,format=rgba', '-frames:v', '1', png]);
  await overlayImage(vertical, png, out);
  expect(await probe(out)).toMatchObject({ width: 720, height: 1280 });
  expect(await probeAudio(out)).not.toBeNull();
  expect((await readTags(out)).comment).toBe(AI_METADATA.comment);
}, FFMPEG_TEST_TIMEOUT_MS);

test('a speech clip keeps 30 s of picture and sound, and its sound alone as mono FLAC at 24 kHz', async () => {
  const talk = join(dir, 'talk.mp4');
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=16', '-f', 'lavfi', '-i', 'sine=frequency=200',
    '-t', '3', '-pix_fmt', 'yuv420p', '-shortest', talk,
  ]);
  const video = join(dir, 'speech.mp4');
  const audio = join(dir, 'speech.flac');
  const kept = await prepareSpeechVideo(talk, video, audio, { max_s: 2 });
  expect(kept).toMatchObject({ width: 640, height: 360 });
  expect(kept.duration_s).toBeCloseTo(2, 0);
  expect(await probeAudio(video)).not.toBeNull();
  const flac = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate', '-of', 'csv=p=0', audio]).toString().trim();
  expect(flac).toBe('flac,24000,1');
  await expect(prepareSpeechVideo(clipA, join(dir, 'silent.mp4'), join(dir, 'silent.flac'))).rejects.toThrow(SequenceToolError);
}, FFMPEG_TEST_TIMEOUT_MS);

test('a new sound under a clip keeps the picture and carries the AI mention', async () => {
  const voice = join(dir, 'voice-24k.flac');
  const out = join(dir, 'revoiced.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2:sample_rate=24000', '-ac', '1', voice]);
  await replaceAudio(clipA, voice, out);
  const streams = streamsOf(out);
  expect(streams.video).not.toBeNull();
  expect(streams.audio).not.toBeNull();
  expect((await readTags(out)).comment).toBe(AI_METADATA.comment);
}, FFMPEG_TEST_TIMEOUT_MS);

test('a sent file that is a list of other files is refused, not read through', async () => {
  // An ffconcat list named .mp4 would copy the files it names (other uploads, next to it) into the result.
  const talk = join(dir, 'talk-for-list.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=16', '-f', 'lavfi', '-i', 'sine', '-t', '1', '-pix_fmt', 'yuv420p', '-shortest', talk]);
  const list = join(dir, 'list.mp4');
  writeFileSync(list, 'ffconcat version 1.0\nfile talk-for-list.mp4\n');
  // FFmpeg alone reads it through: the list is a real threat, not a broken file.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-i', list, '-f', 'null', '-']);
  await expect(prepareMotionClip(list, join(dir, 'never-motion.mp4'))).rejects.toThrow(SequenceToolError);
  await expect(prepareSpeechVideo(list, join(dir, 'never.mp4'), join(dir, 'never.flac'))).rejects.toThrow(SequenceToolError);
}, FFMPEG_TEST_TIMEOUT_MS);
