import type { ExtensionModel } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect } from './dimensions';
import { bindExtension, dropNode, requireNodes, type ExtensionCompiled } from './extensions';

/** The prepared clip's rate, and the one window VACE renders (81 frames, 5 s). */
const RESTYLE_FPS = 16;
const MAX_FRAMES = 81;

/**
 * The nodes the compiler keeps, removes or rewires: the depth of each frame (the control), the
 * reference image, the restyled first frame put before the depth of the others with its mask
 * (0 on it, 1 elsewhere), and VACE.
 */
const RESTYLE_NODES = {
  depth: '4',
  reference: '20',
  referenceScaled: '21',
  otherFrames: '22',
  control: '23',
  firstMask: '24',
  otherMasks: '25',
  masks: '26',
  mask: '27',
  vace: '30',
} as const;
const FIRST_FRAME_NODES = ['otherFrames', 'control', 'firstMask', 'otherMasks', 'masks', 'mask'] as const;

/**
 * What a reference image is to the job: the clip's first frame restyled (the edit makes it), kept
 * as the first frame of the new clip; or any image, a look VACE follows through its reference input.
 */
export type RestyleReference = 'first-frame' | 'look';

export type RestyleInputs = {
  /** The clip prepared by prepareMotionClip (16 fps, 5 s at most, silent). */
  videoRef: string;
  /** Its length in seconds. */
  video_s: number;
  /** The clip's aspect: the output follows it. */
  aspect: Aspect;
  seed: number;
  /** What the scene becomes ("a snowy winter evening", "a watercolor painting"). */
  prompt: string;
  /** The reference image, as the backend's loader names it once uploaded, and what it is to the job. */
  reference?: { imageRef: string; mode: RestyleReference };
};

/** The edit instruction that restyles the clip's first frame: the new look, the frame itself unchanged. */
export function restyleInstruction(prompt: string): string {
  return `Change the look of this image: ${prompt.trim()}. Keep the framing, the camera angle, and the position and pose of every person and object exactly the same.`;
}

/**
 * A restyle (Wan 2.1 VACE 14B): the scene of the clip rebuilt from the text, and the reference when
 * there is one, along the depth of its frames, so that its motion, camera move and timing stay; at
 * 480p and 16 fps. The window is 4n+1 frames covering the clip, 81 at most; VACE pads the up to 3
 * frames that round it up with no control.
 */
export function compileRestyle(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: RestyleInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; seed: number; prompt: string; reference: RestyleReference | null }> {
  if (model.task !== 'v2v-restyle') throw new CompileError(`model ${model.id} runs task ${model.task}, not v2v-restyle`);
  requireNodes(model, template, Object.values(RESTYLE_NODES));
  const { min_duration_s: shortest = 1, max_duration_s: longest = 5, max_chars } = model.limits;
  // the prepared clip of a 5 s source may probe a few milliseconds over 5 s
  if (!(inputs.video_s >= shortest && inputs.video_s <= longest + 0.05)) {
    throw new CompileError(`the clip lasts ${inputs.video_s} s; a restyle takes ${shortest} to ${longest} s`);
  }
  const prompt = inputs.prompt.trim();
  if (!prompt) throw new CompileError('the restyle text is empty');
  if (max_chars !== undefined && prompt.length > max_chars) {
    throw new CompileError(`the restyle text has ${prompt.length} characters, over the ${max_chars} of model ${model.id}`);
  }
  const available = Math.floor(inputs.video_s * RESTYLE_FPS);
  const frames = Math.min(MAX_FRAMES, 4 * Math.ceil((available - 1) / 4) + 1);
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const reference = inputs.reference ?? null;
  const workflow = bindExtension(model, template, {
    video: inputs.videoRef,
    image: reference?.imageRef,
    prompt,
    seed: inputs.seed,
    width,
    height,
    frames,
  });
  const vace = workflow[RESTYLE_NODES.vace]!.inputs;
  if (reference?.mode === 'first-frame') {
    workflow[RESTYLE_NODES.otherFrames]!.inputs.length = frames - 1;
    workflow[RESTYLE_NODES.otherMasks]!.inputs.batch_size = frames - 1;
  } else {
    for (const key of FIRST_FRAME_NODES) dropNode(workflow, RESTYLE_NODES[key]);
    if (!reference) for (const id of [RESTYLE_NODES.reference, RESTYLE_NODES.referenceScaled]) dropNode(workflow, id);
    vace.control_video = [RESTYLE_NODES.depth, 0];
  }
  return {
    workflow,
    output: { ...model.output },
    params: { width, height, frames, seed: inputs.seed, prompt, reference: reference?.mode ?? null },
  };
}
