import type { ExtensionModel } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect } from './dimensions';
import { bindExtension, type ExtensionCompiled } from './extensions';

/** What the two prompts say when the user says nothing: the photo and the clip carry the rest. */
export const MOTION_DEFAULTS = {
  character: 'the character of the reference image, with the same face, hair, clothes and colors',
  motion: 'the character performs the movements of the reference video',
} as const;

/** The prepared clip's rate, and the one window Wan2.2-Animate-2 renders (81 frames, 5 s). */
const MOTION_FPS = 16;
const MAX_FRAMES = 81;

export type MotionInputs = {
  /** The photo of the character, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** The reference clip prepared by prepareMotionClip (16 fps, 5 s at most, silent). */
  videoRef: string;
  /** Its length in seconds. */
  video_s: number;
  /** The clip's aspect: the output follows the motion, and the photo is center-cropped to it. */
  aspect: Aspect;
  seed: number;
  /** What the character looks like. */
  character?: string;
  /** What it does (the motion of the clip, in words). */
  motion?: string;
};

/**
 * A motion transfer (Wan2.2-Animate-2 distilled): the character of the photo performs the motion
 * of the clip, at 480p and 16 fps. The window is 4n+1 frames covering the clip, 81 at most; the
 * node repeats the clip's last frame for the up to 3 frames that round it up.
 */
export function compileMotion(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: MotionInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; seed: number; character: string; motion: string }> {
  if (model.task !== 'motion-transfer') throw new CompileError(`model ${model.id} runs task ${model.task}, not motion-transfer`);
  const { min_duration_s: shortest = 1, max_duration_s: longest = 5, max_chars } = model.limits;
  // the prepared clip of a 5 s source may probe a few milliseconds over 5 s
  if (!(inputs.video_s >= shortest && inputs.video_s <= longest + 0.05)) {
    throw new CompileError(`the reference video lasts ${inputs.video_s} s; a motion transfer takes ${shortest} to ${longest} s`);
  }
  const text = (value: string | undefined, fallback: string, label: string) => {
    const result = (value ?? fallback).trim();
    if (!result) throw new CompileError(`the ${label} is empty`);
    if (max_chars !== undefined && result.length > max_chars) {
      throw new CompileError(`the ${label} has ${result.length} characters, over the ${max_chars} of model ${model.id}`);
    }
    return result;
  };
  const character = text(inputs.character, MOTION_DEFAULTS.character, 'character description');
  const motion = text(inputs.motion, MOTION_DEFAULTS.motion, 'motion description');
  const available = Math.floor(inputs.video_s * MOTION_FPS);
  const frames = Math.min(MAX_FRAMES, 4 * Math.ceil((available - 1) / 4) + 1);
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const workflow = bindExtension(model, template, {
    image: inputs.imageRef,
    video: inputs.videoRef,
    prompt: character,
    motion_prompt: motion,
    seed: inputs.seed,
    width,
    height,
    frames,
  });
  return { workflow, output: { ...model.output }, params: { width, height, frames, seed: inputs.seed, character, motion } };
}
