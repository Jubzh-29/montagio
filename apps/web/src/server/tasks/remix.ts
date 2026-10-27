import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildAss, CAPTION_STYLES, evenWords } from '@montagio/captions';
import {
  cleanHashtags,
  compileMotion,
  compileSwap,
  compileTrendSkeleton,
  dimensionsFor,
  framePoint,
  MAX_SWAP_POINTS,
  parseTrendSkeleton,
  REMIX_CHARACTER_MAX,
  REMIX_POST_LANGUAGES,
  type RemixPostLanguage,
  type SwapPoint,
} from '@montagio/presets';
import { AI_METADATA, assembleShots, cutShot, DEMO_MOVE_METADATA, prepareMotionClip, probe, renderVertical, shotRanges, shotSheet, type CaptionLayer } from '@montagio/sequence';
import type { DemoKind } from '@/lib/api-types';
import { copyCaptionFonts } from '../caption-fonts';
import { demoKindOf } from '../demo-render';
import { JobError } from '../errors';
import { markSkeletonRejected, motionModel, requireExtension, skeletonModel, skeletonRejected, swapModel } from '../extensions';
import { mediaUrlFor } from '../generations';
import { assertAllowedText } from '../guards';
import { jobDir, type JobRecord, type StepPlan, type TaskDef } from '../jobs';
import { cutsOf, readRemixMeta, remixPath, remixShots, REMIX_MOTION_SHOT_MAX_S, REMIX_SCENE_SHOT_MAX_S, type RemixSourceMeta } from '../remix';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const TEXT_MAX = 500;
/** The words written on screen over the first shot: a hook is a few words. */
const ONSCREEN_MAX = 120;
/** A post's caption: TikTok takes 2,200 characters. */
const CAPTION_MAX = 2200;
/** The skeleton and the post Gemma wrote, beside the job's record. */
export const SKELETON_FILE = 'skeleton.json';
const ONSCREEN_STYLE = 'classic' as const;

export type RemixMode = 'motion' | 'scene';
/** One shot of a remix: kept as filmed, or made again (in its own scene: the object the points mark). */
export type RemixShot = { keep: boolean; points?: SwapPoint[]; exclude?: SwapPoint[] };

const isMode = (value: unknown): value is RemixMode => value === 'motion' || value === 'scene';
const isLanguage = (value: unknown): value is RemixPostLanguage => typeof value === 'string' && Object.hasOwn(REMIX_POST_LANGUAGES, value);

/** Points in fractions of a shot's first frame, as the object swap takes them; null when they are not that. */
function pointsOf(raw: unknown): SwapPoint[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SWAP_POINTS) return null;
  const points: SwapPoint[] = [];
  for (const entry of raw) {
    const { x, y } = (entry ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
    points.push({ x, y });
  }
  return points;
}

/** The shots a request gives (one per shot; none: every shot made again), checked for the mode. */
function shotsOf(raw: unknown, count: number, mode: RemixMode, meta: RemixSourceMeta): RemixShot[] {
  if (raw === undefined && mode === 'motion') return Array.from({ length: count }, () => ({ keep: false }));
  if (!Array.isArray(raw) || raw.length !== count) throw new JobError('invalid-input');
  const target = dimensionsFor(meta.aspect, '480p');
  return raw.map((entry): RemixShot => {
    const { keep, points, exclude } = (entry ?? {}) as { keep?: unknown; points?: unknown; exclude?: unknown };
    if (keep !== undefined && typeof keep !== 'boolean') throw new JobError('invalid-input');
    if (keep === true || mode === 'motion') return { keep: keep === true };
    const marked = pointsOf(points);
    const left = pointsOf(exclude);
    // In its own scene, a shot made again needs a point on what the crop to the model's frame keeps.
    if (!marked || marked.length === 0 || !left || !marked.some((point) => framePoint(point, meta, target))) throw new JobError('invalid-input');
    return { keep: false, points: marked, ...(left.length > 0 ? { exclude: left } : {}) };
  });
}

/** A short text of the request, trimmed, `max` characters at most; '' when absent. */
function textOf(value: unknown, max: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > max) throw new JobError('invalid-input');
  return value.trim();
}

/** The post the user keeps with the remix (Gemma's draft, corrected): a caption and its hashtags. */
function postOf(raw: unknown): { caption: string; hashtags: string[] } | undefined {
  if (raw === undefined) return undefined;
  const { caption, hashtags } = (raw ?? {}) as { caption?: unknown; hashtags?: unknown };
  return { caption: textOf(caption, CAPTION_MAX), hashtags: cleanHashtags(hashtags) };
}

const sourceOf = (record: JobRecord) => remixPath(String(record.inputs.remixRef));
const rangesOf = (record: JobRecord) => shotRanges(record.inputs.cuts as number[], Number(record.inputs.frames));

/**
 * A trend's skeleton, read by Gemma 4 E4B on this machine: the first frame of each shot on one sheet,
 * its shots in a line each, the words on screen and the tone; then, in a second pass, the post of its
 * remix (a caption, hashtags, words for the screen) in English or French. Optional within the remix:
 * a ComfyUI that refuses the workflow hides it alone, and the user writes the post.
 */
export const remixSkeletonTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('remix');
    await requireExtension('avatar');
    const model = skeletonModel(lib);
    if (!model || skeletonRejected()) throw new JobError('extension-disabled');
    const meta = await readRemixMeta(body.remixRef);
    if (!meta) throw new JobError('invalid-input');
    const cuts = body.cuts === undefined ? meta.cuts : cutsOf(body.cuts, meta.frames);
    if (!cuts) throw new JobError('invalid-input');
    const language = body.language ?? 'en';
    if (!isLanguage(language)) throw new JobError('language-unsupported');
    const character = textOf(body.character, REMIX_CHARACTER_MAX);
    await assertAllowedText(character);
    return {
      inputs: { remixRef: meta.remixRef, cuts, language, ...(character ? { character } : {}) },
      label: { name: model.name },
      modelId: model.id,
      seed: 0,
      aspect: meta.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'skeleton',
      presetId: 'remix-skeleton',
      // No extension: Gemma refused must not hide the avatar, nor the remix itself.
      extension: null,
      onRejected: markSkeletonRejected,
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        const meta = await readRemixMeta(record.inputs.remixRef);
        if (!template || !meta) throw new Error(`remix skeleton: no workflow for ${model.id}, or the trend is gone`);
        // The first step compiles before the engine writes the job's folder.
        await mkdir(jobDir(record.id), { recursive: true });
        const { thumbs } = await remixShots(meta, record.inputs.cuts as number[]);
        const sheet = join(jobDir(record.id), 'shots.png');
        await shotSheet(thumbs, sheet, { aspect: meta.width / meta.height });
        const character = typeof record.inputs.character === 'string' ? record.inputs.character : '';
        const { workflow, output } = compileTrendSkeleton(model, template, {
          sheetRef: basename(sheet),
          language: record.inputs.language as RemixPostLanguage,
          ...(character ? { character } : {}),
        });
        return { workflow, output, files: [extensionFile(model, 'image', sheet)] };
      },
    },
  ],

  async deliver(record, outputPath, dir) {
    const parsed = parseTrendSkeleton(await readFile(outputPath, 'utf8'));
    const file = join(dir, SKELETON_FILE);
    await writeFile(file, JSON.stringify({ ...parsed, language: record.inputs.language }, null, 2));
    return { outputUrl: mediaUrlFor(file)! };
  },
};

/**
 * A trend remixed (extension "remix"): its shots, cut where FFmpeg found them or where the user moved
 * the cuts, made again one by one with the same references and the same seed, so the character stays
 * the same from shot to shot: by the motion transfer (the character of the photo performs each shot),
 * or in the shot's own scene by the object swap (what the points mark is replaced). A shot may be kept
 * as filmed. The shots are put back on the trend's own frames, at its frame rate; its sound only when
 * asked, with the user's word that they may use it. The user's word that they hold the rights on the
 * trend and the photo is required (the sample made by Montagio with a photo nobody imported aside), and
 * a photo needs the box of the face ticked, every time: it is never deduced from a file sent.
 */
export const remixTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('remix');
    const mode = body.mode ?? 'motion';
    if (!isMode(mode)) throw new JobError('invalid-input');
    if (mode === 'scene') await requireExtension('swap');
    const meta = await readRemixMeta(body.remixRef);
    if (!meta) throw new JobError('invalid-input');
    const cuts = body.cuts === undefined ? meta.cuts : cutsOf(body.cuts, meta.frames);
    if (!cuts) throw new JobError('invalid-input');
    const ranges = shotRanges(cuts, meta.frames);
    const shots = shotsOf(body.shots, ranges.length, mode, meta);
    const made = shots.flatMap((shot, index) => (shot.keep ? [] : [index]));
    if (made.length === 0) throw new JobError('invalid-input');
    const longest = mode === 'motion' ? REMIX_MOTION_SHOT_MAX_S : REMIX_SCENE_SHOT_MAX_S;
    if (made.some((index) => (ranges[index]!.end - ranges[index]!.start) / meta.fps > longest)) throw new JobError('shot-too-long');

    const imageRef = typeof body.imageRef === 'string' && body.imageRef ? body.imageRef : '';
    const photo = imageRef ? await readUploadMeta(imageRef) : null;
    if (imageRef && !photo) throw new JobError('unknown-image');
    if (mode === 'motion' && !photo) throw new JobError('unknown-image');
    const ownFiles = meta.origin === 'sample' && !photo?.personal;
    if (body.rights !== true && !ownFiles) throw new JobError('rights-required');
    if (photo && body.faceConsent !== true) throw new JobError('consent-required');
    const keepSound = body.keepSound === true;
    if (keepSound && (!meta.audio || body.soundRights !== true)) throw new JobError('rights-required');

    const model = mode === 'motion' ? motionModel(lib) : swapModel(lib);
    const max = model.limits.max_chars ?? TEXT_MAX;
    const character = textOf(body.character, max);
    const motion = textOf(body.motion, max);
    const prompt = textOf(body.prompt, max);
    if (mode === 'scene' && !prompt) throw new JobError('invalid-input');
    const onscreen = textOf(body.onscreen, ONSCREEN_MAX);
    const language = body.language ?? 'en';
    if (!isLanguage(language)) throw new JobError('language-unsupported');
    const post = postOf(body.post);
    await assertAllowedText(character, motion, prompt, onscreen, post?.caption, post?.hashtags.join(' '));
    return {
      inputs: {
        remixRef: meta.remixRef,
        origin: meta.origin,
        fps: meta.fps,
        frames: meta.frames,
        width: meta.width,
        height: meta.height,
        cuts,
        mode,
        shots,
        made,
        ...(photo ? { imageRef, faceConsentAt: new Date(Date.now()).toISOString() } : {}),
        character,
        motion,
        prompt,
        keepSound,
        onscreen,
        language,
        ...(post ? { post } : {}),
        personal: photo?.personal ?? false,
      },
      label: { name: model.name },
      modelId: model.id,
      // One seed for every shot: with the same references, the same character from shot to shot.
      seed: randomInt(0, 2 ** 32),
      aspect: meta.aspect,
    };
  },

  steps: (record, lib) =>
    (record.inputs.made as number[]).map(
      (index): StepPlan => ({
        name: `shot ${index + 1}`,
        presetId: record.inputs.mode === 'scene' ? 'swap' : 'motion',
        extension: record.inputs.mode === 'scene' ? 'swap' : 'motion',
        compile: async (current) => {
          const model = lib.extensionModels.get(current.modelId)!;
          const template = lib.extensionTemplates.get(model.workflow);
          if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
          const dir = jobDir(current.id);
          await mkdir(dir, { recursive: true });
          // The shot as filmed (padded to 1 s), then at the 16 fps both models take.
          const range = rangesOf(current)[index]!;
          const cut = join(dir, `shot${index + 1}-source.mp4`);
          await cutShot(sourceOf(current), cut, { ...range, fps: Number(current.inputs.fps) });
          const clip = join(dir, `shot${index + 1}.mp4`);
          const scene = current.inputs.mode === 'scene';
          const prepared = await prepareMotionClip(cut, clip, { max_s: scene ? REMIX_SCENE_SHOT_MAX_S : REMIX_MOTION_SHOT_MAX_S });
          const imageRef = typeof current.inputs.imageRef === 'string' ? current.inputs.imageRef : undefined;
          const aspect = current.aspect ?? '9:16';
          if (!scene) {
            const character = String(current.inputs.character ?? '');
            const motion = String(current.inputs.motion ?? '');
            const { workflow, output } = compileMotion(model, template, {
              imageRef: imageRef!,
              videoRef: basename(clip),
              video_s: prepared.duration_s,
              aspect,
              seed: current.seed,
              ...(character ? { character } : {}),
              ...(motion ? { motion } : {}),
            });
            return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef!)), extensionFile(model, 'video', clip)] };
          }
          const shot = (current.inputs.shots as RemixShot[])[index]!;
          const { workflow, output } = compileSwap(model, template, {
            videoRef: basename(clip),
            video_s: prepared.duration_s,
            source: { width: Number(current.inputs.width), height: Number(current.inputs.height) },
            aspect,
            seed: current.seed,
            prompt: String(current.inputs.prompt),
            points: shot.points ?? [],
            ...(shot.exclude ? { exclude: shot.exclude } : {}),
            ...(imageRef ? { imageRef: basename(uploadPath(imageRef)) } : {}),
          });
          const files = [extensionFile(model, 'video', clip)];
          if (imageRef) files.push(extensionFile(model, 'image', uploadPath(imageRef)));
          return { workflow, output, files };
        },
      }),
    ),

  async deliver(record, _outputPath, dir) {
    const source = sourceOf(record);
    const fps = Number(record.inputs.fps);
    const ranges = rangesOf(record);
    const made = record.inputs.made as number[];
    const clips: string[] = [];
    let demo: DemoKind | undefined;
    for (const [index, range] of ranges.entries()) {
      const step = made.indexOf(index);
      if (step < 0) {
        const kept = join(dir, `shot${index + 1}-kept.mp4`);
        await cutShot(source, kept, { ...range, fps, min_s: 0 });
        clips.push(kept);
        continue;
      }
      const rendered = record.steps[step]?.outputPath;
      if (!rendered) throw new Error(`remix: shot ${index + 1} has no render`);
      const kind = demoKindOf(rendered);
      if (kind === 'moved' || (kind && !demo)) demo = kind;
      clips.push(rendered);
    }
    // The shots made again set the size; a shot kept as filmed is fitted to it.
    const size = await probe(record.steps[0]!.outputPath!);
    const recipe = await (await import('../recipe')).recipeTags('job', record.id, 'video');
    // Shots FFmpeg moved (demo) keep that mention: no model made them.
    const tags = { ...AI_METADATA, ...(demo === 'moved' ? DEMO_MOVE_METADATA : {}), ...recipe };
    const assembled = join(dir, 'remix.mp4');
    const { frames } = await assembleShots(clips, assembled, {
      frames: ranges.map((range) => range.end - range.start),
      fps,
      width: size.width,
      height: size.height,
      ...(record.inputs.keepSound === true ? { audioFrom: source } : {}),
      tags,
    });
    const vertical = join(dir, 'remix-9x16.mp4');
    const onscreen = String(record.inputs.onscreen ?? '');
    const captions = onscreen ? await onscreenLayer(join(dir, 'onscreen'), onscreen, String(record.inputs.language), ranges, fps) : undefined;
    await renderVertical(assembled, vertical, { ...(captions ? { captions } : {}), tags });
    return { outputUrl: mediaUrlFor(assembled)!, verticalUrl: mediaUrlFor(vertical)!, frames, ...(demo ? { demo } : {}) };
  },
};

/**
 * The words written on screen, burned into the 9:16 export over the first shot (2 to 6 s, never past
 * the end), in the captions' plain style: the export of the captions, with the hook as its text.
 */
async function onscreenLayer(dir: string, text: string, language: string, ranges: { start: number; end: number }[], fps: number): Promise<CaptionLayer> {
  const total = ranges.at(-1)!.end / fps;
  const first = (ranges[0]!.end - ranges[0]!.start) / fps;
  const duration_s = Math.min(total, Math.max(2, Math.min(6, first)));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'onscreen.ass'), buildAss({ language, words: evenWords(text, duration_s) }, ONSCREEN_STYLE));
  await copyCaptionFonts(dir, [CAPTION_STYLES[ONSCREEN_STYLE].font.file]);
  return { dir, ass: 'onscreen.ass', fonts: 'fonts' };
}
