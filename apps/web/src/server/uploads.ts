import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pickAspect, type Aspect } from '@montagio/presets';
import { prepareMotionClip, prepareSpeechVideo, prepareVoiceSample, probe } from '@montagio/sequence';
import { imageSize } from 'image-size';
import { MAX_VIDEO_BYTES, MAX_VOICE_BYTES } from '@/lib/limits';
import { getEnv } from './env';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The multipart body around one image: the file and room for its boundaries and headers. */
export const MAX_UPLOAD_FORM_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const EXTENSIONS: Record<string, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const FILE_EXTENSIONS: Record<string, 'png' | 'jpg' | 'webp'> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' };
const SNIFFED: Record<string, string> = { png: 'png', jpg: 'jpg', webp: 'webp' };

/** Where a photo comes from: what decides whether an effect on it asks for consent. */
export type PhotoOrigin = 'upload' | 'sample' | 't2i' | 'edit' | 'frame';
/**
 * `personal`: the photo is, or derives from, a photo someone imported (it may show a real person).
 * `fictional`: the photo was made from a text here, or is an edit of such a photo only: what a character may be made of.
 */
export type Provenance = { origin: PhotoOrigin; personal: boolean; fictional?: true };

export type UploadMeta = { imageRef: string; width: number; height: number; aspect: Aspect } & Provenance;

export class UploadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

export async function saveUpload(file: File): Promise<UploadMeta> {
  const ext = EXTENSIONS[file.type];
  if (!ext) throw new UploadError(415, 'only PNG, JPEG and WebP images are accepted');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(413, 'images are limited to 10 MB');
  return storeImage(new Uint8Array(await file.arrayBuffer()), ext, { origin: 'upload', personal: true });
}

/**
 * Store an image produced on the server as an ordinary upload: the last frame of a shot
 * (the default), the sample photo, or the output of a text-to-image or edit job.
 */
export async function saveUploadFromFile(path: string, provenance: Provenance = { origin: 'frame', personal: false }): Promise<UploadMeta> {
  const ext = FILE_EXTENSIONS[extname(path).toLowerCase()];
  if (!ext) throw new UploadError(415, `unsupported image file ${path}`);
  return storeImage(new Uint8Array(await readFile(path)), ext, provenance);
}

async function storeImage(bytes: Uint8Array, ext: 'png' | 'jpg' | 'webp', provenance: Provenance): Promise<UploadMeta> {
  let width: number | undefined;
  let height: number | undefined;
  let sniffed: string | undefined;
  let orientation: number | undefined;
  try {
    ({ width, height, type: sniffed, orientation } = imageSize(bytes));
  } catch {
    throw new UploadError(415, 'the file is not a readable image');
  }
  if (!width || !height || !sniffed || SNIFFED[sniffed] !== ext) {
    throw new UploadError(415, 'the file content does not match its image type');
  }
  // EXIF orientations 5-8 store the picture rotated by 90°: measure it upright.
  if (orientation !== undefined && orientation >= 5 && orientation <= 8) [width, height] = [height, width];

  const id = randomUUID();
  const dir = join(getEnv().data, 'uploads');
  await mkdir(dir, { recursive: true });
  const meta: UploadMeta = { imageRef: `uploads/${id}.${ext}`, width, height, aspect: pickAspect(width, height), ...provenance };
  await writeFile(join(dir, `${id}.${ext}`), bytes);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
  return meta;
}

export async function readUploadMeta(imageRef: string): Promise<UploadMeta | null> {
  const match = /^uploads\/([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(imageRef);
  if (!match) return null;
  try {
    const meta = JSON.parse(await readFile(join(getEnv().data, 'uploads', `${match[1]}.json`), 'utf8')) as Partial<UploadMeta>;
    // Written before photos kept their origin: the cautious reading is an imported photo.
    return { origin: 'upload', personal: true, ...meta } as UploadMeta;
  } catch {
    return null;
  }
}

export { MAX_VIDEO_BYTES };
/** The multipart body around one video: the file and room for its boundaries and headers. */
export const MAX_VIDEO_FORM_BYTES = MAX_VIDEO_BYTES + 64 * 1024;
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
/** The shortest reference clip the motion model animates. */
const MIN_VIDEO_S = 1;
/** The longest one it animates in one pass (context windows); a restyle rebuilds its first 5 s. */
export const MAX_REFERENCE_S = 30;

/** A reference clip for a motion transfer or a restyle, prepared once at upload: 30 s at most, 16 fps, silent. */
export type VideoMeta = {
  videoRef: string;
  /** What is kept, and how long the clip sent was. */
  duration_s: number;
  sourceDuration_s: number;
  frames: number;
  width: number;
  height: number;
  aspect: Aspect;
};

const videosDir = () => join(getEnv().data, 'uploads', 'videos');

/**
 * Keep the first 30 s of a reference clip at 16 fps, without its sound (it may be music the
 * user cannot share), in the folder of the uploads. A file that is not a readable video, or
 * shorter than 1 s, is refused.
 */
export async function saveVideoUpload(file: File): Promise<VideoMeta> {
  const ext = VIDEO_TYPES[file.type];
  if (!ext) throw new UploadError(415, 'only MP4, WebM and QuickTime videos are accepted');
  if (file.size > MAX_VIDEO_BYTES) throw new UploadError(413, 'videos are limited to 50 MB');
  const id = randomUUID();
  const dir = videosDir();
  await mkdir(dir, { recursive: true });
  const source = join(dir, `${id}.source.${ext}`);
  const out = join(dir, `${id}.mp4`);
  const metaFile = join(dir, `${id}.json`);
  try {
    await writeFile(source, new Uint8Array(await file.arrayBuffer()));
    let sourceDuration_s: number;
    let prepared: Awaited<ReturnType<typeof prepareMotionClip>>;
    try {
      sourceDuration_s = (await probe(source)).duration_s;
      prepared = await prepareMotionClip(source, out, { max_s: MAX_REFERENCE_S });
    } catch {
      throw new UploadError(400, 'the file is not a readable video');
    }
    if (!(prepared.duration_s >= MIN_VIDEO_S)) throw new UploadError(400, `a reference video lasts ${MIN_VIDEO_S} s at least`);
    const meta: VideoMeta = {
      videoRef: `videos/${id}.mp4`,
      duration_s: prepared.duration_s,
      sourceDuration_s,
      frames: prepared.frames,
      width: prepared.width,
      height: prepared.height,
      aspect: pickAspect(prepared.width, prepared.height),
    };
    await writeFile(metaFile, JSON.stringify(meta));
    return meta;
  } catch (error) {
    // A refused or half-made clip leaves nothing behind: no video without its meta.
    await Promise.all([rm(out, { force: true }), rm(metaFile, { force: true })]);
    throw error;
  } finally {
    await rm(source, { force: true });
  }
}

/** A prepared reference clip, or null when its ref is not one or its clip or meta is gone. */
export async function readVideoMeta(videoRef: string): Promise<VideoMeta | null> {
  const match = /^videos\/([0-9a-f-]{36})\.mp4$/.exec(videoRef);
  if (!match) return null;
  try {
    await access(join(videosDir(), `${match[1]}.mp4`));
    return JSON.parse(await readFile(join(videosDir(), `${match[1]}.json`), 'utf8')) as VideoMeta;
  } catch {
    return null;
  }
}

export { MAX_VOICE_BYTES };
export const MAX_VOICE_FORM_BYTES = MAX_VOICE_BYTES + 64 * 1024;
/** A voice sample shorter than this gives Chatterbox too little of the voice to copy. */
export const MIN_VOICE_S = 3;
const VOICE_TYPES: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

export type VoiceMeta = { voiceRef: string; duration_s: number };

const voicesDir = () => join(getEnv().data, 'uploads', 'voices');

/**
 * A voice sample for the avatar: its first 20 s, mono FLAC at 24 kHz, in the folder of the
 * uploads. A file that is not readable audio, or shorter than 3 s, is refused and leaves nothing.
 */
export async function saveVoiceUpload(file: File): Promise<VoiceMeta> {
  const ext = VOICE_TYPES[file.type];
  if (!ext) throw new UploadError(415, 'only WAV, MP3, M4A, FLAC, OGG and WebM audio is accepted');
  if (file.size > MAX_VOICE_BYTES) throw new UploadError(413, 'voice samples are limited to 10 MB');
  const id = randomUUID();
  const dir = voicesDir();
  await mkdir(dir, { recursive: true });
  const source = join(dir, `${id}.source.${ext}`);
  const out = join(dir, `${id}.flac`);
  const metaFile = join(dir, `${id}.json`);
  try {
    await writeFile(source, new Uint8Array(await file.arrayBuffer()));
    let duration_s: number;
    try {
      ({ duration_s } = await prepareVoiceSample(source, out));
    } catch {
      throw new UploadError(400, 'the file is not readable audio');
    }
    if (!(duration_s >= MIN_VOICE_S)) throw new UploadError(400, `a voice sample lasts ${MIN_VOICE_S} s at least`);
    const meta: VoiceMeta = { voiceRef: `voices/${id}.flac`, duration_s };
    await writeFile(metaFile, JSON.stringify(meta));
    return meta;
  } catch (error) {
    await Promise.all([rm(out, { force: true }), rm(metaFile, { force: true })]);
    throw error;
  } finally {
    await rm(source, { force: true });
  }
}

/** A prepared voice sample, or null when its ref is not one or its file or meta is gone. */
export async function readVoiceMeta(voiceRef: string): Promise<VoiceMeta | null> {
  const match = /^voices\/([0-9a-f-]{36})\.flac$/.exec(voiceRef);
  if (!match) return null;
  try {
    await access(join(voicesDir(), `${match[1]}.flac`));
    return JSON.parse(await readFile(join(voicesDir(), `${match[1]}.json`), 'utf8')) as VoiceMeta;
  } catch {
    return null;
  }
}

/** A clip whose voice will change: the video kept (30 s at most) and its sound alone, the voice change's input. */
export type SpeechMeta = { speechRef: string; audioRef: string; duration_s: number; width: number; height: number; aspect: Aspect };

const speechDir = () => join(getEnv().data, 'uploads', 'speech');

/** Keep a clip's first 30 s with its sound, and that sound as mono FLAC; a clip without sound is refused. */
async function storeSpeech(source: string): Promise<SpeechMeta> {
  const id = randomUUID();
  const dir = speechDir();
  await mkdir(dir, { recursive: true });
  const video = join(dir, `${id}.mp4`);
  const audio = join(dir, `${id}.flac`);
  const metaFile = join(dir, `${id}.json`);
  try {
    let prepared: Awaited<ReturnType<typeof prepareSpeechVideo>>;
    try {
      prepared = await prepareSpeechVideo(source, video, audio);
    } catch {
      throw new UploadError(400, 'the file is not a readable video with sound');
    }
    if (!(prepared.duration_s >= 1)) throw new UploadError(400, 'a speech video lasts 1 s at least');
    const meta: SpeechMeta = {
      speechRef: `speech/${id}.mp4`,
      audioRef: `speech/${id}.flac`,
      duration_s: prepared.duration_s,
      width: prepared.width,
      height: prepared.height,
      aspect: pickAspect(prepared.width, prepared.height),
    };
    await writeFile(metaFile, JSON.stringify(meta));
    return meta;
  } catch (error) {
    await Promise.all([rm(video, { force: true }), rm(audio, { force: true }), rm(metaFile, { force: true })]);
    throw error;
  }
}

/** A video sent for a voice change (MP4, WebM or QuickTime, 50 MB at most). */
export async function saveSpeechUpload(file: File): Promise<SpeechMeta> {
  const ext = VIDEO_TYPES[file.type];
  if (!ext) throw new UploadError(415, 'only MP4, WebM and QuickTime videos are accepted');
  if (file.size > MAX_VIDEO_BYTES) throw new UploadError(413, 'videos are limited to 50 MB');
  const dir = speechDir();
  await mkdir(dir, { recursive: true });
  const source = join(dir, `${randomUUID()}.source.${ext}`);
  try {
    await writeFile(source, new Uint8Array(await file.arrayBuffer()));
    return await storeSpeech(source);
  } finally {
    await rm(source, { force: true });
  }
}

/** A clip made here (an avatar) prepared the same way. */
export function saveSpeechFromFile(path: string): Promise<SpeechMeta> {
  return storeSpeech(path);
}

export async function readSpeechMeta(speechRef: string): Promise<SpeechMeta | null> {
  const match = /^speech\/([0-9a-f-]{36})\.mp4$/.exec(speechRef);
  if (!match) return null;
  try {
    await access(join(speechDir(), `${match[1]}.mp4`));
    await access(join(speechDir(), `${match[1]}.flac`));
    return JSON.parse(await readFile(join(speechDir(), `${match[1]}.json`), 'utf8')) as SpeechMeta;
  } catch {
    return null;
  }
}
