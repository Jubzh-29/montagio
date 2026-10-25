import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { DemoRender } from '@montagio/comfy-adapter';
import { dimensionsFor, frameCount, pickAspect, type Library } from '@montagio/presets';
import { DEMO_MOVE_METADATA, placeholderClip } from '@montagio/sequence';
import { motionKeyframes, toZoompan, type Keyframe } from '@montagio/showcase/motion';
import { imageSize } from 'image-size';
import type { DemoKind } from '@/lib/api-types';
import { getEnv } from './env';

// What the demo backend hands out instead of colour bars (DemoKind): the render a GPU session
// made of the very same sample photo ("example"), or the photo itself moved by FFmpeg ("moved").
// The caption says which; neither is a model run.

/** The camera examples are 20-step renders, whatever model a preset now starts on (the Turbo). */
const CAMERA_EXAMPLES_MODEL = 'wan22-i2v-a14b-fun-camera';

/**
 * The clips GPU session S2 rendered from a sample photo of the Studio (demo-assets/images), by preset;
 * a motion also needs the sample reference clip (demo-assets/videos). The avatar and the motion are the
 * full renders (demo-assets/examples), with the voice, not the muted previews of their cards.
 */
const EXAMPLES: Record<string, { clip: string; sample: string; video?: string; model?: string }> = {
  breathing: { clip: 'presets/previews/breathing.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  'crash-push': { clip: 'presets/previews/crash-push.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  'drift-left-push': { clip: 'presets/previews/drift-left-push.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  'pull-back-tilt-up': { clip: 'presets/previews/pull-back-tilt-up.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  'push-and-settle': { clip: 'presets/previews/push-and-settle.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  'rise-and-push': { clip: 'presets/previews/rise-and-push.mp4', sample: 'sample-16x9.png', model: CAMERA_EXAMPLES_MODEL },
  squish: { clip: 'presets/effects/previews/squish.mp4', sample: 'sample-subject.png' },
  'frozen-moment': { clip: 'presets/effects/previews/frozen-moment.mp4', sample: 'sample-subject.png' },
  'wardrobe-swap': { clip: 'presets/transitions/previews/wardrobe-swap.mp4', sample: 'sample-portrait.png' },
  avatar: { clip: 'demo-assets/examples/avatar.mp4', sample: 'sample-portrait.png' },
  motion: { clip: 'demo-assets/examples/motion.mp4', sample: 'sample-character.png', video: 'sample-dance.mp4' },
};

/** A preset without a camera move of its own (an effect, a hook, an avatar, a motion): a slow push-in. */
const PUSH_IN: Keyframe[] = [
  { t: 0, zoom: 1, cx: 0.5, cy: 0.5 },
  { t: 1, zoom: 1.15, cx: 0.5, cy: 0.5 },
];
const DEFAULT_TIMING = { duration_s: 5, fps: 16 };
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const MOVED_DIR = () => join(getEnv().data, 'demo-renders');

const holder = globalThis as typeof globalThis & {
  __montagioSampleHashes?: Map<string, Promise<string | null>>;
  __montagioDemoMoves?: Map<string, Promise<string>>;
};
const sampleHashes = (holder.__montagioSampleHashes ??= new Map());
// Moves in flight, by output file: two jobs on the same photo and preset share one FFmpeg run.
const moves = (holder.__montagioDemoMoves ??= new Map());

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function sampleHash(folder: 'images' | 'videos', file: string): Promise<string | null> {
  const path = join(getEnv().root, 'demo-assets', folder, file);
  let known = sampleHashes.get(path);
  if (!known) {
    known = readFile(path).then(sha256, () => null);
    sampleHashes.set(path, known);
  }
  return known;
}

/** The demo's file for a job: the example of its sample photo, else that photo moved; undefined for a job without a photo or a video. */
export function demoRender(library: Promise<Library>): DemoRender {
  return async ({ presetId, output, files }) => {
    if (output !== 'video') return undefined;
    const photo = files.find((file) => IMAGE_EXTENSIONS.has(extname(file.path).toLowerCase()))?.path;
    if (!photo) return undefined;
    const bytes = new Uint8Array(await readFile(photo));
    const hash = sha256(bytes);
    const example = EXAMPLES[presetId];
    if (example && (await sampleHash('images', example.sample)) === hash && (await sameVideo(example.video, files))) {
      const clip = join(getEnv().root, ...example.clip.split('/'));
      if (await exists(clip)) return clip;
    }
    return movePhoto(photo, bytes, hash, presetId, await library);
  };
}

/** Without a sample clip to match, true; else whether the job's clip is that sample, byte for byte. */
async function sameVideo(sample: string | undefined, files: { path: string }[]): Promise<boolean> {
  if (!sample) return true;
  const clip = files.find((file) => extname(file.path).toLowerCase() === '.mp4')?.path;
  if (!clip) return false;
  const hash = await readFile(clip).then((bytes) => sha256(new Uint8Array(bytes)), () => null);
  return hash !== null && hash === (await sampleHash('videos', sample));
}

async function movePhoto(photo: string, bytes: Uint8Array, hash: string, presetId: string, library: Library): Promise<string> {
  const out = join(MOVED_DIR(), `${hash.slice(0, 16)}-${presetId}.mp4`);
  let move = moves.get(out);
  if (!move) {
    move = (async () => {
      if (await exists(out)) return out;
      const preset = library.presets.get(presetId);
      const { width, height } = imageSize(bytes);
      const size = dimensionsFor(pickAspect(width ?? 16, height ?? 9), '480p');
      const { duration_s, fps } = preset?.defaults ?? DEFAULT_TIMING;
      const frames = frameCount(duration_s, fps);
      const motion = toZoompan(preset ? motionKeyframes(preset.camera) : PUSH_IN, frames);
      await mkdir(MOVED_DIR(), { recursive: true });
      await placeholderClip(photo, out, { ...size, fps, frames, motion, tags: DEMO_MOVE_METADATA });
      return out;
    })().finally(() => moves.delete(out));
    moves.set(out, move);
  }
  return move;
}

/** The model that rendered a camera example, which the caption names instead of the one the job asked for; undefined otherwise. */
export function demoExampleModel(outputPath: string | undefined): string | undefined {
  if (!outputPath) return undefined;
  const rel = relative(getEnv().root, outputPath).split(sep).join('/');
  return Object.values(EXAMPLES).find((example) => example.clip === rel)?.model;
}

/** Which demo file a backend output is, from where it lies; undefined for any other file (a model's, or the bars). */
export function demoKindOf(outputPath: string | undefined): DemoKind | undefined {
  if (!outputPath) return undefined;
  const inside = (base: string) => {
    const rel = relative(base, outputPath);
    return rel !== '' && !rel.startsWith('..') && !rel.includes(':');
  };
  if (inside(MOVED_DIR())) return 'moved';
  const { root } = getEnv();
  const rel = relative(root, outputPath).split(sep).join('/');
  return Object.values(EXAMPLES).some((example) => example.clip === rel) ? 'example' : undefined;
}
