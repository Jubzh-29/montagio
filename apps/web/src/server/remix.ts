import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pickAspect, type Aspect } from '@montagio/presets';
import { concatClips, cutShot, detectShots, framesAt, prepareRemixSource, shotRanges } from '@montagio/sequence';
import { getEnv } from './env';
import { mediaUrlFor } from './generations';
import { libraryMotionPath } from './motions';
import { remixFile } from './tasks/files';
import { MAX_VIDEO_BYTES, UploadError } from './uploads';

/** The longest trend a remix takes: its first 60 s are kept. */
export const REMIX_MAX_S = 60;
/** The most shots a remix makes again: each is a render. */
export const REMIX_MAX_SHOTS = 16;
/** The longest shot made again in its own scene: one VACE window of the object swap. */
export const REMIX_SCENE_SHOT_MAX_S = 5;
/** The longest shot the motion transfer takes (its context windows). */
export const REMIX_MOTION_SHOT_MAX_S = 30;

/** Where a remix's trend comes from: a file sent, a link imported on this machine, the sample. */
export type RemixOrigin = 'upload' | 'link' | 'sample';
/** The sound of a trend, as its platform names it, and where to search for it there. */
export type RemixSound = { title: string; artists: string[]; searchUrl: string };

export type RemixSourceMeta = {
  remixRef: string;
  duration_s: number;
  fps: number;
  frames: number;
  width: number;
  height: number;
  aspect: Aspect;
  /** Whether the trend has a sound of its own (it is never kept unless asked). */
  audio: boolean;
  origin: RemixOrigin;
  /** The link it was imported from: shown to the user here, never written in a recipe. */
  link?: { url: string; host: string };
  sound?: RemixSound;
  /** The first frames of the shots FFmpeg found (frame 0 not listed): the shot list starts from them. */
  cuts: number[];
};

const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

const remixDir = () => join(getEnv().data, 'uploads', 'remix');

/** The prepared trend behind a remixRef ("remix/<id>.mp4"); the ref is checked first. */
export function remixPath(remixRef: string): string {
  const path = remixFile(remixRef);
  if (!path) throw new UploadError(400, 'invalid-input');
  return path;
}

/** The first frame of the shot that starts at `frame`: made once, next to the trend. */
const thumbPath = (remixRef: string, frame: number) => remixPath(remixRef).replace(/\.mp4$/, `-f${frame}.png`);

/**
 * A trend prepared for a remix from a local file: its first 60 s at a constant frame rate (30 fps at
 * most), its sound kept aside, its shots found by FFmpeg's scene filter. A clip under 1 s is refused.
 */
export async function saveRemixSource(
  input: string,
  origin: RemixOrigin,
  extra: { link?: RemixSourceMeta['link']; sound?: RemixSound; cuts?: number[] } = {},
): Promise<RemixSourceMeta> {
  const id = randomUUID();
  await mkdir(remixDir(), { recursive: true });
  const out = join(remixDir(), `${id}.mp4`);
  const metaFile = join(remixDir(), `${id}.json`);
  try {
    const prepared = await prepareRemixSource(input, out, { max_s: REMIX_MAX_S });
    if (prepared.duration_s < 1 || prepared.frames < 2) throw new UploadError(400, 'invalid-input');
    // Cuts known in advance (the sample's) are kept; else FFmpeg finds them.
    const cuts = extra.cuts ?? (await detectShots(out)).cuts;
    const meta: RemixSourceMeta = {
      remixRef: `remix/${id}.mp4`,
      duration_s: prepared.duration_s,
      fps: prepared.fps,
      frames: prepared.frames,
      width: prepared.width,
      height: prepared.height,
      aspect: pickAspect(prepared.width, prepared.height),
      audio: prepared.audio,
      origin,
      ...(extra.link ? { link: extra.link } : {}),
      ...(extra.sound ? { sound: extra.sound } : {}),
      cuts: cuts.slice(0, REMIX_MAX_SHOTS - 1),
    };
    await writeFile(metaFile, JSON.stringify(meta));
    return meta;
  } catch (error) {
    // A refused or half-made trend leaves nothing behind.
    await Promise.all([rm(out, { force: true }), rm(metaFile, { force: true })]);
    throw error;
  }
}

/** A trend sent from this browser: MP4, WebM or QuickTime, 50 MB at most. */
export async function saveRemixUpload(file: File): Promise<RemixSourceMeta> {
  const ext = VIDEO_TYPES[file.type];
  if (!ext) throw new UploadError(415, 'only MP4, WebM and QuickTime videos are accepted');
  if (file.size > MAX_VIDEO_BYTES) throw new UploadError(413, 'videos are limited to 50 MB');
  await mkdir(remixDir(), { recursive: true });
  const source = join(remixDir(), `${randomUUID()}.source.${ext}`);
  try {
    await writeFile(source, new Uint8Array(await file.arrayBuffer()));
    return await saveRemixSource(source, 'upload');
  } catch (error) {
    if (error instanceof UploadError) throw error;
    // FFmpeg could not read it: not a video it knows.
    throw new UploadError(400, 'invalid-input');
  } finally {
    await rm(source, { force: true });
  }
}

/** The motions of the library the sample trend is cut from, 2 s of each: Montagio's own fictional characters. */
export const REMIX_SAMPLE_MOTIONS = ['hip-hop', 'wave-clap', 'jumping-jacks'] as const;

/**
 * The sample trend: three moves of the Motion library cut together, 2 s each, silent. Made by
 * Montagio from fictional characters, it needs no rights and is what the showcase and the demo show.
 */
export async function saveRemixSample(): Promise<RemixSourceMeta> {
  // A fresh install has no data folder yet.
  await mkdir(getEnv().data, { recursive: true });
  const work = await mkdtemp(join(getEnv().data, 'remix-sample-'));
  try {
    const shots = [];
    for (const [index, id] of REMIX_SAMPLE_MOTIONS.entries()) {
      const shot = join(work, `${index}.mp4`);
      await cutShot(libraryMotionPath(id), shot, { start: 0, end: 32, fps: 16 });
      shots.push(shot);
    }
    const joined = join(work, 'sample.mp4');
    await concatClips(shots, joined, { width: 480, height: 832 }, 16);
    // The three moves share a grey studio: the scene filter may not see the cuts, which are known.
    return await saveRemixSource(joined, 'sample', { cuts: [32, 64] });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function readRemixMeta(remixRef: unknown): Promise<RemixSourceMeta | null> {
  if (typeof remixRef !== 'string' || !remixFile(remixRef)) return null;
  try {
    return JSON.parse(await readFile(remixPath(remixRef).replace(/\.mp4$/, '.json'), 'utf8')) as RemixSourceMeta;
  } catch {
    return null;
  }
}

/**
 * The cuts a request gives, checked: whole frames inside the trend, each once, in order, fewer than
 * `REMIX_MAX_SHOTS` (so at most that many shots); null when they are not that.
 */
export function cutsOf(raw: unknown, frames: number): number[] | null {
  if (!Array.isArray(raw) || raw.length > REMIX_MAX_SHOTS - 1) return null;
  if (!raw.every((cut) => Number.isInteger(cut) && cut > 0 && cut < frames)) return null;
  return [...new Set(raw as number[])].sort((a, b) => a - b);
}

/**
 * The shots of a trend for `cuts`: their frame ranges, and the first frame of each as an image the
 * page shows and Gemma reads (made once per frame, next to the trend).
 */
export async function remixShots(meta: RemixSourceMeta, cuts: readonly number[]): Promise<{ ranges: { start: number; end: number }[]; thumbs: string[] }> {
  const ranges = shotRanges(cuts, meta.frames);
  const paths = ranges.map((range) => thumbPath(meta.remixRef, range.start));
  const missing: number[] = [];
  for (const [index, path] of paths.entries()) {
    const there = await access(path).then(() => true, () => false);
    if (!there) missing.push(index);
  }
  if (missing.length > 0) {
    await framesAt(remixPath(meta.remixRef), missing.map((index) => ranges[index]!.start), (index) => paths[missing[index]!]!);
  }
  return { ranges, thumbs: paths };
}

/** What the page shows of a trend: its numbers, its sound, its shots, with the URLs of the files. */
export async function remixSummary(meta: RemixSourceMeta, cuts: readonly number[] = meta.cuts) {
  const shots = await remixShots(meta, cuts);
  return {
    ...meta,
    url: mediaUrlFor(remixPath(meta.remixRef))!,
    shots: shots.ranges.map((range, index) => ({ ...range, thumbUrl: mediaUrlFor(shots.thumbs[index]!)! })),
  };
}
