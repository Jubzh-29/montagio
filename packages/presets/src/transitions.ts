import type { ExtensionModel, LockEntry } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, frameCount, type Aspect } from './dimensions';
import { bindExtension, bypassNode, compileEdit, requireNodes, type ExtensionCompiled } from './extensions';
import type { TransitionPreset } from './schema';

/** Nodes of workflows/wan22-flf2v-transition.api.json that compileTransition keeps, removes or rewires. */
const TRANSITION_NODES = { loraHigh: '91', loraLow: '92', shiftHigh: '54', shiftLow: '55', samplerHigh: '57', samplerLow: '58' } as const;
/**
 * The template's two paths: the 4-step LoRAs of lightx2v (cfg 1, the experts split at step 2,
 * shift 5), and 20 steps without them (cfg 4, split at step 10, shift 8).
 */
const TRANSITION_SAMPLING = {
  fast: { steps: 4, cfg: 1, split: 2, shift: 5 },
  quality: { steps: 20, cfg: 4, split: 10, shift: 8 },
} as const;

export type TransitionInputs = {
  /** The first frame (the user's photo), as the backend's loader names it once uploaded. */
  startRef: string;
  /** The last frame (the edit's output for a hook). */
  endRef: string;
  /** What happens between the two frames. */
  prompt: string;
  /** Empty or absent keeps the workflow's negative prompt. */
  negative?: string;
  seed: number;
  aspect: Aspect;
  /** 2 to 5 s (5 by default), at 16 fps. */
  duration_s?: number;
  /** The 4-step LoRAs (default), or 20 steps without them. */
  fast?: boolean;
};

/** The passage from a first to a last frame (Wan 2.2 FLF2V), at 480p and 16 fps; both frames are center-cropped to the size. */
export function compileTransition(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: TransitionInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; prompt: string; seed: number; fast: boolean }> {
  if (model.task !== 'flf2v') throw new CompileError(`model ${model.id} runs task ${model.task}, not flf2v`);
  requireNodes(model, template, Object.values(TRANSITION_NODES));
  const prompt = inputs.prompt.trim();
  if (!prompt) throw new CompileError('the motion prompt is empty');
  const max = model.limits.max_chars;
  if (max !== undefined && prompt.length > max) throw new CompileError(`the motion prompt has ${prompt.length} characters, over the ${max} of model ${model.id}`);
  const duration_s = inputs.duration_s ?? 5;
  const { min_duration_s: min = 2, max_duration_s: longest = 5 } = model.limits;
  if (duration_s < min || duration_s > longest) throw new CompileError(`a transition lasts ${min} to ${longest} s, not ${duration_s}`);
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const frames = frameCount(duration_s, 16);
  const fast = inputs.fast ?? true;

  const workflow = bindExtension(model, template, {
    image: inputs.startRef,
    end_image: inputs.endRef,
    prompt,
    negative: inputs.negative || undefined,
    seed: inputs.seed,
    width,
    height,
    frames,
  });
  const sampling = fast ? TRANSITION_SAMPLING.fast : TRANSITION_SAMPLING.quality;
  if (!fast) {
    bypassNode(workflow, TRANSITION_NODES.loraHigh);
    bypassNode(workflow, TRANSITION_NODES.loraLow);
  }
  workflow[TRANSITION_NODES.shiftHigh]!.inputs.shift = sampling.shift;
  workflow[TRANSITION_NODES.shiftLow]!.inputs.shift = sampling.shift;
  Object.assign(workflow[TRANSITION_NODES.samplerHigh]!.inputs, { steps: sampling.steps, cfg: sampling.cfg, end_at_step: sampling.split });
  Object.assign(workflow[TRANSITION_NODES.samplerLow]!.inputs, { steps: sampling.steps, cfg: sampling.cfg, start_at_step: sampling.split });
  return { workflow, output: { ...model.output }, params: { width, height, frames, prompt, seed: inputs.seed, fast } };
}

export type HookEditInputs = {
  /** The user's photo: the first frame of the transition. */
  imageRef: string;
  /** The second image a two-reference hook needs (the outfit of wardrobe-swap); ignored otherwise. */
  image2Ref?: string;
  seed: number;
  fast?: boolean;
};

/** First job of a hook: the edit makes its end frame from the photo. */
export function compileHookEdit(
  hook: TransitionPreset,
  editModel: ExtensionModel,
  editTemplate: ApiWorkflow,
  inputs: HookEditInputs,
  lock: ReadonlyMap<string, LockEntry>,
) {
  const two = hook.end_frame.references === 2;
  if (two && !inputs.image2Ref) throw new CompileError(`hook ${hook.id} needs a second image (image2Ref)`);
  return compileEdit(
    editModel,
    editTemplate,
    {
      imageRef: inputs.imageRef,
      instruction: hook.end_frame.instruction,
      seed: inputs.seed,
      ...(inputs.fast === undefined ? {} : { fast: inputs.fast }),
      ...(hook.end_frame.look ? { look: hook.end_frame.look } : {}),
      ...(two ? { image2Ref: inputs.image2Ref } : {}),
    },
    lock,
  );
}

/** Second job of a hook: the transition from the photo to the end frame the edit made. */
export function compileHookTransition(
  hook: TransitionPreset,
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { imageRef: string; endRef: string; seed: number; aspect: Aspect; fast?: boolean },
) {
  if (hook.models.preferred !== model.id) throw new CompileError(`hook ${hook.id} runs on model ${hook.models.preferred}, not ${model.id}`);
  return compileTransition(model, template, {
    startRef: inputs.imageRef,
    endRef: inputs.endRef,
    prompt: hook.prompt.motion,
    negative: hook.prompt.negative,
    seed: inputs.seed,
    aspect: inputs.aspect,
    duration_s: hook.defaults.duration_s,
    ...(inputs.fast === undefined ? {} : { fast: inputs.fast }),
  });
}
