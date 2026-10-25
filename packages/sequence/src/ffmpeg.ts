import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AI_AUDIO_METADATA, AI_METADATA, metadataArgs, type VideoTags } from './tags';

export { AI_METADATA };

export class SequenceToolError extends Error {
  override name = 'SequenceToolError';
  /** "tool-missing": the binary cannot be found; "tool-failed": it ran and failed. */
  constructor(
    message: string,
    readonly code: 'tool-missing' | 'tool-failed' = 'tool-failed',
  ) {
    super(message);
  }
}

type Tool = { bin: string; envVar: 'MONTAGIO_FFMPEG' | 'MONTAGIO_FFPROBE' };

const ffmpeg = (): Tool => ({ bin: process.env.MONTAGIO_FFMPEG ?? 'ffmpeg', envVar: 'MONTAGIO_FFMPEG' });
const ffprobe = (): Tool => ({ bin: process.env.MONTAGIO_FFPROBE ?? 'ffprobe', envVar: 'MONTAGIO_FFPROBE' });

/** Run a tool with an argument array (never a shell string) and return its stdout. */
function run(tool: Tool, args: string[], opts: { failOnStderr?: boolean; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(tool.bin, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...(opts.cwd ? { cwd: opts.cwd } : {}) }, (error, stdout, stderr) => {
      if (!error && opts.failOnStderr && String(stderr).trim()) {
        const tail = String(stderr).trim().split('\n').slice(-3).join(' | ');
        return reject(new SequenceToolError(`${tool.bin} reported: ${tail}`));
      }
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(
          new SequenceToolError(`"${tool.bin}" was not found: install FFmpeg or set ${tool.envVar} to its full path`, 'tool-missing'),
        );
      }
      const tail = String(stderr).trim().split('\n').slice(-3).join(' | ');
      reject(new SequenceToolError(`${tool.bin} failed: ${tail || error.message}`));
    });
  });
}

/** Input options that open a local file and nothing else: a URL given as the media is not fetched. */
const LOCAL_FILE_ONLY = ['-protocol_whitelist', 'file'];

/**
 * The demuxers allowed for a file someone sent: real media containers only. An ffconcat list or a
 * playlist named .mp4 would make FFmpeg read the other local files it names into the result.
 */
const SENT_VIDEO = ['-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm'];
const SENT_AUDIO = ['-format_whitelist', 'wav,mp3,flac,ogg,aac,mov,mp4,m4a,3gp,3g2,mj2,matroska,webm'];

export async function probe(
  media: string,
): Promise<{ width: number; height: number; duration_s: number; fps: number; codec: string; pixFmt: string }> {
  const out = await run(ffprobe(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,codec_name,pix_fmt:format=duration',
    '-of', 'json',
    ...LOCAL_FILE_ONLY, media,
  ]);
  const json = JSON.parse(out) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string; codec_name?: string; pix_fmt?: string }[];
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  if (!stream?.width || !stream.height) throw new SequenceToolError(`no video stream in ${media}`);
  const [num, den] = (stream.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = num && den ? num / den : 0;
  return {
    width: stream.width,
    height: stream.height,
    duration_s: Number(json.format?.duration ?? 0),
    fps,
    codec: stream.codec_name ?? '',
    pixFmt: stream.pix_fmt ?? '',
  };
}

/** The first audio stream of a file, or null when it has none (every Wan clip is silent). */
export async function probeAudio(
  media: string,
): Promise<{ codec: string; sampleRate: number; channels: number; duration_s: number } | null> {
  const out = await run(ffprobe(), [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels,duration:format=duration',
    '-of', 'json',
    ...LOCAL_FILE_ONLY, media,
  ]);
  const json = JSON.parse(out) as {
    streams?: { codec_name?: string; sample_rate?: string; channels?: number; duration?: string }[];
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  if (!stream) return null;
  return {
    codec: stream.codec_name ?? '',
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: stream.channels ?? 0,
    duration_s: Number(stream.duration ?? json.format?.duration ?? 0),
  };
}

/** The container-level tags of a media file, as ffprobe reads them. */
export async function readTags(media: string): Promise<Record<string, string>> {
  const out = await run(ffprobe(), ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', media]);
  return (JSON.parse(out) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
}

/** The tags of a video someone sent (a recipe's clip): the local file alone, read as a real container. */
export async function readSentTags(media: string): Promise<Record<string, string>> {
  const out = await run(ffprobe(), ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', ...LOCAL_FILE_ONLY, ...SENT_VIDEO, media]);
  return (JSON.parse(out) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
}

/**
 * Copy a clip into an MP4 that carries the AI mention (and `extra` tags: its recipe), without re-encoding.
 * Whatever the source container (ComfyUI's SaveWEBM writes WebM), the result is
 * an MP4; it is written next to `out` first, so `out` is never half-written.
 */
export async function tagClip(input: string, out: string, extra: VideoTags = {}): Promise<void> {
  const partial = `${out}.part`;
  try {
    await run(ffmpeg(), [
      '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v', '-map', '0:a?', '-c', 'copy',
      ...metadataArgs({ ...AI_METADATA, ...extra }),
      '-movflags', '+faststart',
      '-f', 'mp4', partial,
    ]);
    await rename(partial, out);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Copy a FLAC (music, speech) with the AI mention as its tags, without re-encoding. */
export async function tagAudio(input: string, out: string): Promise<void> {
  const partial = `${out}.part`;
  try {
    await run(ffmpeg(), ['-loglevel', 'error', '-y', '-i', input, '-map', '0:a', '-c', 'copy', ...metadataArgs(AI_AUDIO_METADATA), '-f', 'flac', partial]);
    await rename(partial, out);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Write the last frame of a clip as a PNG: seek near the end, keep overwriting until the final frame. */
export async function extractLastFrame(video: string, outPng: string): Promise<void> {
  await run(ffmpeg(), ['-loglevel', 'error', '-y', '-sseof', '-1', '-i', video, '-update', '1', '-q:v', '1', outPng]);
}

/** The first frame of a clip, at its full size: the face a translated clip starts from, the frame a restyle's edit changes. */
export async function extractFirstFrame(video: string, outPng: string): Promise<void> {
  await run(ffmpeg(), ['-loglevel', 'error', '-y', ...LOCAL_FILE_ONLY, '-i', video, '-frames:v', '1', '-q:v', '1', outPng]);
}

/** Join clips into one H.264 film; every clip is fitted (letterboxed) to `size` and `fps`. */
export async function concatClips(
  clips: string[],
  out: string,
  size: { width: number; height: number },
  fps: number,
  opts: { tags?: VideoTags } = {},
): Promise<void> {
  if (clips.length === 0) throw new SequenceToolError('concatClips needs at least one clip');
  const { width: w, height: h } = size;
  const inputs = clips.flatMap((clip) => ['-i', clip]);
  const fitted = clips
    .map(
      (_, i) =>
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    )
    .join(';');
  const joined = `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[out]`;
  await run(ffmpeg(), [
    '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', `${fitted};${joined}`,
    '-map', '[out]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    ...metadataArgs(opts.tags ?? AI_METADATA),
    out,
  ]);
}

/** The audio of the film, when it has some (a soundtrack), is copied as it is. */
const VERTICAL_X264 = [
  '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'copy',
] as const;

/**
 * 9:16 cut for Reels/TikTok: the full frame centred over a blurred, cropped copy of itself.
 * The filter works frame by frame, so the cut of a film equals the films of the cuts:
 * the showcase prepares the cut of each clip and joins them. A soundtrack goes along;
 * an encoder that drops the audio (`-an`, the showcase's) keeps the cut silent.
 */
export async function exportVertical(
  input: string,
  out: string,
  opts: { encoder?: readonly string[]; colour?: string; tags?: VideoTags } = {},
): Promise<void> {
  const filter = [
    '[0:v]split[bg][fg]',
    '[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:2[blurred]',
    '[fg]scale=720:-2[front]',
    `[blurred][front]overlay=(W-w)/2:(H-h)/2,setsar=1,${opts.colour ?? 'format=yuv420p'}[out]`,
  ].join(';');
  await run(ffmpeg(), [
    '-loglevel', 'error', '-y',
    '-i', input,
    '-filter_complex', filter,
    '-map', '[out]',
    '-map', '0:a?',
    ...(opts.encoder ?? VERTICAL_X264),
    ...metadataArgs(opts.tags ?? AI_METADATA),
    out,
  ]);
}

/** The frame rate of a vertical render: under 24 fps, a whole multiple of the clip's (16 → 32), so captions move smoothly and no frame is shown longer than another. */
export function outputFps(fps: number): number {
  return fps > 0 && fps < 24 ? fps * Math.ceil(24 / fps) : fps;
}

/**
 * Burned-in captions: an ASS script and the folder of its fonts, both named relative to `dir`, where
 * FFmpeg runs. Relative names keep the drive colon and the spaces of a Windows path out of the filter
 * graph, where they would need escaping; libass then takes the fonts of that folder only by name.
 */
export type CaptionLayer = { dir: string; ass: string; fonts: string };

const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;

function captionFilter(captions: CaptionLayer | undefined): string[] {
  if (!captions) return [];
  for (const name of [captions.ass, captions.fonts]) {
    if (!PLAIN_NAME.test(name) || name === '.' || name === '..') throw new SequenceToolError(`"${name}" is not a plain file name in the captions folder`);
  }
  return [`ass=${captions.ass}:fontsdir=${captions.fonts}`];
}

/** The 9:16 picture: the whole frame centred over a blurred, cropped copy of itself, then the captions. */
function verticalGraph(width: number, height: number, fps: number, captions: CaptionLayer | undefined, after: string[] = []): string {
  const rate = outputFps(fps);
  return [
    '[0:v]split[bg][fg]',
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:2[blurred]`,
    `[fg]scale=${width}:-2[front]`,
    `[blurred][front]${['overlay=(W-w)/2:(H-h)/2', 'setsar=1', ...(rate !== fps ? [`fps=${rate}`] : []), ...captionFilter(captions), ...after].join(',')}[out]`,
  ].join(';');
}

/**
 * A clip in 9:16 for TikTok, Reels and Shorts, at 1080x1920 by default, with captions burned in when
 * given: the frame of `exportVertical`, a frame rate under 24 fps doubled (`outputFps`), the sound in
 * AAC and the AI mention (`tags`). The Share button of a finished clip can call it with no captions.
 */
export async function renderVertical(input: string, out: string, opts: { width?: number; height?: number; captions?: CaptionLayer; tags?: VideoTags } = {}): Promise<void> {
  const { width = 1080, height = 1920 } = opts;
  captionFilter(opts.captions);
  const { fps } = await probe(input);
  await writeAtomically(
    out,
    (partial) => [
      '-loglevel', 'error', '-y',
      ...LOCAL_FILE_ONLY, '-i', input,
      '-filter_complex', verticalGraph(width, height, fps, opts.captions, ['format=yuv420p']),
      '-map', '[out]', '-map', '0:a?',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      ...metadataArgs(opts.tags ?? AI_METADATA),
      '-movflags', '+faststart',
      '-f', 'mp4', partial,
    ],
    opts.captions ? { cwd: opts.captions.dir } : {},
  );
}

/**
 * One frame of `renderVertical` at `at_s`, as a PNG `width` pixels wide (540 by default): drawn at
 * 1080x1920 then scaled, so it shows what the export will. The seek comes after the input, so the
 * frame keeps its time in the clip and the captions theirs.
 */
export async function captionFrame(input: string, out: string, opts: { at_s: number; captions: CaptionLayer; width?: number }): Promise<void> {
  captionFilter(opts.captions);
  const { fps } = await probe(input);
  await writeAtomically(
    out,
    (partial) => [
      '-loglevel', 'error', '-y',
      ...LOCAL_FILE_ONLY, '-i', input,
      '-filter_complex', verticalGraph(1080, 1920, fps, opts.captions, [`scale=${opts.width ?? 540}:-2`]),
      '-map', '[out]',
      '-ss', String(Math.max(0, opts.at_s)),
      '-frames:v', '1',
      '-f', 'image2', '-c:v', 'png', partial,
    ],
    { cwd: opts.captions.dir },
  );
}

/** The speech of a clip for Whisper: its sound alone as mono FLAC at 16 kHz, `max_s` seconds at most (60). A clip without sound fails before any encoding. */
export async function extractSpeech(input: string, out: string, opts: { max_s?: number } = {}): Promise<{ duration_s: number }> {
  if (!(await probeAudio(input))) throw new SequenceToolError(`no audio stream in ${input}`);
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, '-i', input,
    '-map', '0:a:0', '-vn', '-map_metadata', '-1',
    '-t', String(opts.max_s ?? 60),
    '-ac', '1', '-ar', '16000',
    '-c:a', 'flac', '-f', 'flac', partial,
  ]);
  return { duration_s: (await probeAudio(out))?.duration_s ?? 0 };
}

/**
 * The one encoding of every showcase clip, placeholder and 9:16 cut. Identical
 * settings give identical H.264 headers, so the browser can join clips with
 * `-c copy`; no B-frames and a keyframe every 16 frames keep each clip a clean
 * series of closed GOPs. CRF 23 with the slow preset keeps a 1080p clip at about
 * 5 MB, 42 to 43 dB PSNR from its SeedVR2 output (CRF 18 veryfast: 10 MB, 45 dB),
 * so the showcase stays well under the 1 GB of a Hugging Face Space.
 */
export const SHOWCASE_X264: readonly string[] = [
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '23',
  '-bf', '0', '-g', '16', '-keyint_min', '16', '-sc_threshold', '0',
  '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-an', '-movflags', '+faststart',
];

/**
 * The colour stage of every showcase encode: limited-range BT.709 4:2:0. A JPEG photo
 * decodes to full range: without this, a placeholder's headers differ from a render's.
 */
export const SHOWCASE_COLOUR = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';

/**
 * Put a soundtrack under a film. The film keeps its exact length and every frame, copied
 * without re-encoding; the music is converted to 48 kHz stereo, padded with silence when
 * it is shorter and cut when it is longer, with a fade-out at the end (`fadeOut_s`, above 0, 1.5 s
 * by default, at most a quarter of the film), then encoded as AAC. Never `-shortest`,
 * which would cut the film to a short music.
 */
export async function mixMusic(
  film: string,
  music: string,
  out: string,
  opts: { gainDb?: number; fadeOut_s?: number } = {},
): Promise<void> {
  // Both land in an FFmpeg filter: a NaN or a fade of 0 s (which afade reads as its default) would not fail here.
  const gainDb = opts.gainDb ?? 0;
  const fadeOut_s = opts.fadeOut_s ?? 1.5;
  if (!Number.isFinite(gainDb)) throw new SequenceToolError(`mixMusic: gainDb ${gainDb} is not a number of decibels`);
  if (!(Number.isFinite(fadeOut_s) && fadeOut_s > 0)) throw new SequenceToolError(`mixMusic: fadeOut_s ${fadeOut_s} is not a number of seconds above 0`);
  const { duration_s } = await probe(film);
  if (!(duration_s > 0)) throw new SequenceToolError(`no duration in ${film}`);
  const fade = Math.min(fadeOut_s, duration_s / 4);
  const audio = [
    '[1:a]aformat=sample_rates=48000:channel_layouts=stereo',
    'apad',
    `atrim=0:${duration_s.toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    `afade=t=out:st=${(duration_s - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
    `volume=${gainDb}dB[music]`,
  ].join(',');
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    '-i', film,
    '-i', music,
    '-filter_complex', audio,
    '-map', '0:v:0', '-map', '[music]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    ...metadataArgs(AI_METADATA),
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
}

/** Run FFmpeg into `<out>.part`, then rename: `out` is never half-written. */
async function writeAtomically(out: string, args: (partial: string) => string[], opts: { cwd?: string } = {}): Promise<void> {
  const partial = `${out}.part`;
  try {
    await run(ffmpeg(), args(partial), opts);
    await rename(partial, out);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Re-encode a clip in the showcase encoding, fitted (letterboxed) to `width`×`height` at `fps`, with `tags`. */
export async function normalizeClip(
  input: string,
  out: string,
  opts: { width: number; height: number; fps: number; tags: VideoTags },
): Promise<void> {
  const { width: w, height: h, fps } = opts;
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v:0',
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},${SHOWCASE_COLOUR}`,
    ...SHOWCASE_X264,
    ...metadataArgs(opts.tags),
    '-f', 'mp4', partial,
  ]);
}

/**
 * The reference clip of a motion transfer, as Wan2.2-Animate-2 takes it: its first `max_s`
 * seconds (5 by default) at `fps` (16; no ComfyUI core node lowers a frame rate), without sound
 * (the user's clip may carry music they cannot share), in H.264 with even dimensions, and
 * without its metadata (a phone writes where it filmed; the AI mention is put on the render).
 * `input` is read as a local file only. A file without a video stream fails before any
 * encoding. Returns what compileMotion needs.
 */
export async function prepareMotionClip(
  input: string,
  out: string,
  opts: { max_s?: number; fps?: number } = {},
): Promise<{ duration_s: number; frames: number; width: number; height: number }> {
  const { max_s = 5, fps = 16 } = opts;
  await probe(input);
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, ...SENT_VIDEO, '-i', input,
    '-map', '0:v:0', '-an', '-map_metadata', '-1',
    '-t', String(max_s),
    '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-f', 'mp4', partial,
  ]);
  const prepared = await probe(out);
  return { duration_s: prepared.duration_s, frames: Math.round(prepared.duration_s * fps), width: prepared.width, height: prepared.height };
}

/**
 * A voice sample for the avatar's cloned voice: its first `max_s` seconds (20 by default),
 * mono at 24 kHz, in FLAC, without any video stream nor metadata (a phone writes where it
 * recorded). `input` is read as a local file only. A file without an audio stream fails
 * before any encoding. Returns the length kept.
 */
export async function prepareVoiceSample(input: string, out: string, opts: { max_s?: number } = {}): Promise<{ duration_s: number }> {
  const { max_s = 20 } = opts;
  if (!(await probeAudio(input))) throw new SequenceToolError(`no audio stream in ${input}`);
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, ...SENT_AUDIO, '-i', input,
    '-map', '0:a:0', '-vn', '-map_metadata', '-1',
    '-t', String(max_s),
    '-ac', '1', '-ar', '24000',
    '-c:a', 'flac', '-f', 'flac', partial,
  ]);
  return { duration_s: (await probeAudio(out))?.duration_s ?? 0 };
}

/** The side of one picture of a moodboard sheet, in pixels. */
export const MOODBOARD_TILE = 512;

/**
 * A moodboard sheet: one to four reference pictures, each cropped to a square, side by side
 * (two by two for four), as one PNG the edit reads as a style reference. Every input is read as
 * a local file only.
 */
export async function moodboardSheet(inputs: readonly string[], out: string): Promise<{ width: number; height: number }> {
  if (inputs.length < 1 || inputs.length > 4) throw new SequenceToolError(`a moodboard holds 1 to 4 pictures, not ${inputs.length}`);
  const side = MOODBOARD_TILE;
  const tiles = inputs.map((_, index) => `[${index}:v]scale=${side}:${side}:force_original_aspect_ratio=increase,crop=${side}:${side},setsar=1,format=rgb24[t${index}]`);
  const labels = inputs.map((_, index) => `[t${index}]`).join('');
  const grid = inputs.length === 4;
  const layout = grid ? '0_0|w0_0|0_h0|w0_h0' : inputs.map((_, index) => (index === 0 ? '0_0' : `${side * index}_0`)).join('|');
  const join = inputs.length === 1 ? '[t0]null[out]' : `${labels}xstack=inputs=${inputs.length}:layout=${layout}[out]`;
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...inputs.flatMap((input) => [...LOCAL_FILE_ONLY, '-i', input]),
    '-filter_complex', [...tiles, join].join(';'),
    '-map', '[out]', '-frames:v', '1', '-map_metadata', '-1',
    '-f', 'image2', '-c:v', 'png', partial,
  ]);
  return grid ? { width: side * 2, height: side * 2 } : { width: side * inputs.length, height: side };
}

/**
 * Lay a transparent PNG (an ad's tagline, drawn by the browser) over a 9:16 clip: the image is
 * scaled to the clip, the sound is kept, and the result carries the AI mention. Both inputs are
 * read as local files only.
 */
export async function overlayImage(input: string, image: string, out: string): Promise<void> {
  const { width, height } = await probe(input);
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, '-i', input,
    ...LOCAL_FILE_ONLY, '-i', image,
    '-filter_complex', `[1:v]scale=${width}:${height}[over];[0:v][over]overlay=0:0,format=yuv420p[out]`,
    '-map', '[out]', '-map', '0:a?',
    ...VERTICAL_X264,
    '-c:a', 'copy',
    ...metadataArgs(AI_METADATA),
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
}

/**
 * A clip whose speech will be said in another voice: its first `max_s` seconds (30 by default)
 * as an H.264 and AAC MP4 without metadata, and its sound alone as mono FLAC at 24 kHz, the
 * voice change's input. A file without a sound stream fails before any encoding; both are
 * read and written as local files only.
 */
export async function prepareSpeechVideo(
  input: string,
  outVideo: string,
  outAudio: string,
  opts: { max_s?: number } = {},
): Promise<{ duration_s: number; width: number; height: number }> {
  const { max_s = 30 } = opts;
  if (!(await probeAudio(input))) throw new SequenceToolError(`no audio stream in ${input}`);
  await writeAtomically(outVideo, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, ...SENT_VIDEO, '-i', input,
    '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1',
    '-t', String(max_s),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
  await writeAtomically(outAudio, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, '-i', outVideo,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000',
    '-c:a', 'flac', '-f', 'flac', partial,
  ]);
  const { duration_s, width, height } = await probe(outVideo);
  return { duration_s, width, height };
}

/** A clip with a new sound (a voice changed): the picture copied, the sound in AAC, the AI mention. */
export async function replaceAudio(video: string, audio: string, out: string): Promise<void> {
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, '-i', video,
    ...LOCAL_FILE_ONLY, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    ...metadataArgs(AI_METADATA),
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
}

/**
 * A light copy of a clip for a looping gallery tile: `width` pixels wide and a
 * high CRF, so a dozen tiles cost the visitor a megabyte or two, not twenty.
 */
export async function previewClip(input: string, out: string, opts: { width: number; tags: VideoTags }): Promise<void> {
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v:0',
    '-vf', `scale=${opts.width}:-2,setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
    ...metadataArgs(opts.tags),
    '-f', 'mp4', partial,
  ]);
}

/**
 * The still a gallery tile shows while its clip loads: the clip's first frame as a JPEG,
 * `width` wide, with `comment` (the AI-generated mention) in a comment segment, as a clip
 * carries it in its metadata.
 */
export async function posterFrame(input: string, out: string, opts: { width: number; comment: string }): Promise<void> {
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=${opts.width}:-2`,
    '-q:v', '5',
    '-f', 'image2', '-c:v', 'mjpeg', partial,
  ]);
  await writeFile(out, withJpegComment(await readFile(out), opts.comment));
}

/** A JPEG with a comment segment (COM: FF FE, its length, the text) right after its start marker. */
export function withJpegComment(jpeg: Buffer, comment: string): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const text = Buffer.from(comment, 'utf8');
  const segment = Buffer.alloc(4 + text.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(text.length + 2, 2);
  text.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** zoompan expressions (z, x, y) in terms of `on`, the output frame number. */
export type ZoompanExpr = { z: string; x: string; y: string };

/**
 * A stand-in clip made from a still: the photo is scaled to cover twice the
 * output size, then `zoompan` moves a `width`×`height` window over it.
 */
export async function placeholderClip(
  image: string,
  out: string,
  opts: { width: number; height: number; fps: number; frames: number; motion: ZoompanExpr; tags: VideoTags },
): Promise<void> {
  const { width: w, height: h, fps, frames, motion } = opts;
  const filter = [
    `scale=${2 * w}:${2 * h}:force_original_aspect_ratio=increase`,
    `crop=${2 * w}:${2 * h}`,
    `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=1:s=${w}x${h}:fps=${fps}`,
    'setsar=1',
    SHOWCASE_COLOUR,
  ].join(',');
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    '-loop', '1', '-i', image,
    '-vf', filter,
    '-frames:v', String(frames),
    ...SHOWCASE_X264,
    ...metadataArgs(opts.tags),
    '-f', 'mp4', partial,
  ]);
}

/** Join clips of one encoding without re-encoding them (concat demuxer, `-c copy`), with `tags`. */
export async function concatCopy(clips: string[], out: string, tags: VideoTags): Promise<void> {
  if (clips.length === 0) throw new SequenceToolError('concatCopy needs at least one clip');
  const dir = await mkdtemp(join(tmpdir(), 'montagio-concat-'));
  try {
    const list = join(dir, 'list.txt');
    // The concat demuxer reads one quoted path per line; a quote inside is written '\''.
    await writeFile(list, clips.map((clip) => `file '${resolve(clip).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`).join(''));
    await writeAtomically(out, (partial) => [
      '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy',
      ...metadataArgs(tags),
      '-movflags', '+faststart',
      '-f', 'mp4', partial,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A fingerprint of a clip's H.264 headers (SPS/PPS, colour description included).
 * Clips joined with `-c copy` play with the first clip's headers: they must all match.
 */
export async function headerHash(media: string): Promise<string> {
  const out = await run(ffprobe(), [
    '-v', 'error', '-show_data_hash', 'SHA256', '-select_streams', 'v:0', '-show_entries', 'stream=extradata_hash', '-of', 'csv=p=0', media,
  ]);
  const hash = out.trim();
  if (!hash) throw new SequenceToolError(`no video headers in ${media}`);
  return hash;
}

/** Decode a whole file and fail on the first error FFmpeg reports (a truncated or mismatched stream). */
export async function decodeCheck(media: string): Promise<void> {
  await run(ffmpeg(), ['-v', 'error', '-xerror', '-i', media, '-f', 'null', '-'], { failOnStderr: true });
}

// --- Trend remix: a clip of several shots, each shot made again, put back on the same frames ----

/** The frame rate a remix source keeps: its own, halved (or more) above 30 fps, so a 60 fps phone clip runs at 30. */
export const REMIX_MAX_FPS = 30;

/** The frame rate kept from a source at `fps`: itself up to 30, else divided by the smallest whole number that brings it there. */
export function remixFps(fps: number): number {
  if (!(fps > 0)) return REMIX_MAX_FPS;
  return fps <= REMIX_MAX_FPS ? fps : fps / Math.ceil(fps / REMIX_MAX_FPS);
}

/** The frames of a video's first stream, counted from its packets (exact, without decoding). */
export async function countFrames(media: string): Promise<number> {
  const out = await run(ffprobe(), [
    '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0',
    ...LOCAL_FILE_ONLY, media,
  ]);
  return Number(out.trim().split(/\s+/)[0]) || 0;
}

/**
 * A trend's clip prepared once for a remix: its first `max_s` seconds (60 by default) at a constant
 * frame rate (its own, 30 fps at most, `remixFps`), in H.264 with even sizes, its sound kept in AAC
 * when it has one, without its metadata (a phone writes where it filmed). Read as a local file and a
 * real container only. Returns what the shot list and the reassembly count on: the exact frame count.
 */
export async function prepareRemixSource(
  input: string,
  out: string,
  opts: { max_s?: number } = {},
): Promise<{ duration_s: number; fps: number; frames: number; width: number; height: number; audio: boolean }> {
  const { max_s = 60 } = opts;
  const source = await probe(input);
  const fps = remixFps(source.fps);
  const audio = (await probeAudio(input)) !== null;
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, ...SENT_VIDEO, '-i', input,
    '-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : []), '-map_metadata', '-1',
    '-t', String(max_s),
    '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
  const prepared = await probe(out);
  return { duration_s: prepared.duration_s, fps: prepared.fps, frames: await countFrames(out), width: prepared.width, height: prepared.height, audio };
}

/**
 * Where a clip's shots start: the frames FFmpeg's scene filter scores over `threshold` (0.3 by
 * default), none closer than `minShot_s` (0.25 s) to the cut before it or to either end, so a flash
 * is not a shot. The first shot starts at frame 0, which is not listed.
 */
export async function detectShots(
  video: string,
  opts: { threshold?: number; minShot_s?: number } = {},
): Promise<{ cuts: number[]; fps: number; frames: number }> {
  const { threshold = 0.3, minShot_s = 0.25 } = opts;
  const { fps } = await probe(video);
  const frames = await countFrames(video);
  const out = await run(ffmpeg(), [
    '-loglevel', 'error', '-nostats',
    ...LOCAL_FILE_ONLY, '-i', video,
    '-an', '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-f', 'null', '-',
  ]);
  const minGap = Math.max(1, Math.round(minShot_s * fps));
  const cuts: number[] = [];
  for (const match of out.matchAll(/pts_time:([\d.]+)/g)) {
    const frame = Math.round(Number(match[1]) * fps);
    const previous = cuts.at(-1) ?? 0;
    if (frame - previous >= minGap && frames - frame >= minGap) cuts.push(frame);
  }
  return { cuts, fps, frames };
}

/** The [start, end) frame ranges of the shots `cuts` make in a clip of `frames` frames. */
export function shotRanges(cuts: readonly number[], frames: number): { start: number; end: number }[] {
  const starts = [0, ...[...new Set(cuts)].filter((cut) => cut > 0 && cut < frames).sort((a, b) => a - b)];
  return starts.map((start, index) => ({ start, end: starts[index + 1] ?? frames }));
}

/**
 * One shot of a remix source, frames [start, end), silent, at the source's frame rate: the clip a
 * model makes again. A shot shorter than `min_s` (1 s, the shortest clip the video models take)
 * is padded with its last frame; the reassembly cuts it back to its own length.
 */
export async function cutShot(video: string, out: string, opts: { start: number; end: number; fps: number; min_s?: number }): Promise<{ frames: number }> {
  const { start, end, fps, min_s = 1 } = opts;
  if (!(end > start)) throw new SequenceToolError(`a shot needs at least one frame, not ${start} to ${end}`);
  const frames = end - start;
  const pad = Math.max(0, Math.ceil(min_s * fps) - frames);
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...LOCAL_FILE_ONLY, '-i', video,
    '-map', '0:v:0', '-an', '-map_metadata', '-1',
    '-vf', `trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS${pad > 0 ? `,tpad=stop_mode=clone:stop=${pad}` : ''}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-f', 'mp4', partial,
  ]);
  return { frames: frames + pad };
}

/** Frames `at` of a clip, as PNGs at `out(index)`, at the clip's size: the first frame of each shot. */
export async function framesAt(video: string, at: readonly number[], out: (index: number) => string): Promise<string[]> {
  const paths: string[] = [];
  for (const [index, frame] of at.entries()) {
    const path = out(index);
    await writeAtomically(path, (partial) => [
      '-loglevel', 'error', '-y',
      ...LOCAL_FILE_ONLY, '-i', video,
      '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-map_metadata', '-1',
      '-f', 'image2', '-c:v', 'png', partial,
    ]);
    paths.push(path);
  }
  return paths;
}

/**
 * A contact sheet of up to 16 pictures, in reading order, `cols` across (4): the shots of a remix as
 * the captioning model reads them. Each tile keeps the pictures' shape (`aspect`, width over height),
 * `tile` pixels wide (256); the empty places of the last row stay white.
 */
export async function shotSheet(
  inputs: readonly string[],
  out: string,
  opts: { cols?: number; tile?: number; aspect: number },
): Promise<{ width: number; height: number }> {
  if (inputs.length < 1 || inputs.length > 16) throw new SequenceToolError(`a shot sheet holds 1 to 16 pictures, not ${inputs.length}`);
  const cols = Math.min(opts.cols ?? 4, inputs.length);
  const rows = Math.ceil(inputs.length / cols);
  const w = opts.tile ?? 256;
  const h = 2 * Math.round(w / opts.aspect / 2);
  const tiles = inputs.map(
    (_, index) => `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=rgb24[t${index}]`,
  );
  const blanks = Array.from({ length: rows * cols - inputs.length }, (_, index) => `color=c=white:s=${w}x${h}:d=1,format=rgb24[b${index}]`);
  const labels = [...inputs.map((_, index) => `[t${index}]`), ...blanks.map((_, index) => `[b${index}]`)].join('');
  const layout = Array.from({ length: rows * cols }, (_, index) => `${(index % cols) * w}_${Math.floor(index / cols) * h}`).join('|');
  const join = rows * cols === 1 ? '[t0]null[out]' : `${labels}xstack=inputs=${rows * cols}:layout=${layout}[out]`;
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...inputs.flatMap((input) => [...LOCAL_FILE_ONLY, '-i', input]),
    '-filter_complex', [...tiles, ...blanks, join].join(';'),
    '-map', '[out]', '-frames:v', '1', '-map_metadata', '-1',
    '-f', 'image2', '-c:v', 'png', partial,
  ]);
  return { width: cols * w, height: rows * h };
}

/**
 * A remix put back together: each rendered shot fitted to the source's size, retimed to the
 * source's frame rate and cut, or padded with its last frame, to the exact frame count of the shot
 * it replaces, then joined; so every cut falls on the frame it fell on in the source. The sound is
 * the source's when `audioFrom` is given, else there is none.
 */
export async function assembleShots(
  clips: readonly string[],
  out: string,
  opts: { frames: readonly number[]; fps: number; width: number; height: number; audioFrom?: string; tags?: VideoTags },
): Promise<{ frames: number }> {
  if (clips.length === 0 || clips.length !== opts.frames.length) throw new SequenceToolError('assembleShots needs one frame count per clip');
  const { fps, width: w, height: h } = opts;
  const fitted = clips.map((_, index) => {
    const n = opts.frames[index]!;
    return (
      `[${index}:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
      `tpad=stop_mode=clone:stop=${n},trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
    );
  });
  const joined = `${clips.map((_, index) => `[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[out]`;
  await writeAtomically(out, (partial) => [
    '-loglevel', 'error', '-y',
    ...clips.flatMap((clip) => [...LOCAL_FILE_ONLY, '-i', clip]),
    ...(opts.audioFrom ? [...LOCAL_FILE_ONLY, '-i', opts.audioFrom] : []),
    '-filter_complex', `${fitted.join(';')};${joined}`,
    '-map', '[out]',
    ...(opts.audioFrom ? ['-map', `${clips.length}:a:0?`, '-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
    '-r', String(fps),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ...metadataArgs(opts.tags ?? AI_METADATA),
    '-movflags', '+faststart',
    '-f', 'mp4', partial,
  ]);
  return { frames: opts.frames.reduce((sum, n) => sum + n, 0) };
}

const checkedTools = new Map<string, Promise<void>>();

/** Fail fast (and once per binary pair) when FFmpeg or ffprobe is not installed. */
export function ensureTools(): Promise<void> {
  const key = `${ffmpeg().bin}|${ffprobe().bin}`;
  let check = checkedTools.get(key);
  if (!check) {
    check = Promise.all([run(ffmpeg(), ['-version']), run(ffprobe(), ['-version'])]).then(() => undefined);
    check.catch(() => checkedTools.delete(key));
    checkedTools.set(key, check);
  }
  return check;
}
