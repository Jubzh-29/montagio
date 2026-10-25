import type { ExtensionModel } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect } from './dimensions';
import { bindExtension, bypassNode, requireNodes, type ExtensionCompiled } from './extensions';

/** What the two prompts say when the user says nothing: the photo and the clip carry the rest. */
export const MOTION_DEFAULTS = {
  character: 'the character of the reference image, with the same face, hair, clothes and colors',
  motion: 'the character performs the movements of the reference video',
} as const;

import { motionFrames, motionWindows, MOTION_WINDOW_FRAMES } from './motion-windows';

/** The node of the context windows, which a clip of one window does without. */
const CONTEXT_NODE = '610';

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
 * of the clip, at 480p and 16 fps. The video is 4n+1 frames covering the clip, up to the model's
 * longest (30 s, 481 frames); the node repeats the clip's last frame for the up to 3 frames that
 * round it up. Past one window of 81 frames the context windows sample it; within one, they are
 * removed and the model goes straight to its cache.
 */
export function compileMotion(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: MotionInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; windows: number; seed: number; character: string; motion: string }> {
  if (model.task !== 'motion-transfer') throw new CompileError(`model ${model.id} runs task ${model.task}, not motion-transfer`);
  requireNodes(model, template, [CONTEXT_NODE]);
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
  const frames = motionFrames(inputs.video_s, longest);
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
  if (frames <= MOTION_WINDOW_FRAMES) bypassNode(workflow, CONTEXT_NODE);
  return { workflow, output: { ...model.output }, params: { width, height, frames, windows: motionWindows(frames), seed: inputs.seed, character, motion } };
}
