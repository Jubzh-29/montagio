import type { ExtensionModel } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect } from './dimensions';
import { bindExtension, dropNode, requireNodes, type ExtensionCompiled } from './extensions';

/** The prepared clip's rate, and the one window VACE renders (81 frames, 5 s). */
const SWAP_FPS = 16;
const MAX_FRAMES = 81;
/** Enough to mark an object and what touches it; SAM 2 needs one. */
export const MAX_SWAP_POINTS = 8;

/** The nodes the compiler keeps or removes: the points, the new object's photo and VACE. */
const SWAP_NODES = {
  points: '41',
  reference: '20',
  referenceFitted: '21',
  vace: '30',
} as const;

/** A point on the clip's first frame, in fractions of its width and height (0 to 1, from the top left). */
export type SwapPoint = { x: number; y: number };

export type SwapInputs = {
  /** The clip prepared by prepareMotionClip (16 fps, silent). */
  videoRef: string;
  /** Its length in seconds. */
  video_s: number;
  /** The size of its frames: the points are fractions of it, before the aspect's crop. */
  source: { width: number; height: number };
  /** The clip's aspect: the output follows it. */
  aspect: Aspect;
  seed: number;
  /** What the object becomes ("a red vintage motorbike"). */
  prompt: string;
  /** Points on the object, on the first frame. */
  points: SwapPoint[];
  /** Points on what is not the object, when the tracker takes too much. */
  exclude?: SwapPoint[];
  /** The photo of the new object, as the backend's loader names it once uploaded. */
  imageRef?: string;
};

/**
 * Where a point of the source frame lands once the frame is scaled to `target` with ComfyUI's
 * centre crop (ImageScale, crop "center": the sides or the top and bottom cut evenly, then scaled):
 * whole pixels of the target, or null when the crop cut it away.
 */
export function framePoint(point: SwapPoint, source: { width: number; height: number }, target: { width: number; height: number }) {
  const oldAspect = source.width / source.height;
  const newAspect = target.width / target.height;
  // the rounding of comfy.utils.common_upscale
  const cropX = oldAspect > newAspect ? Math.round((source.width - source.width * (newAspect / oldAspect)) / 2) : 0;
  const cropY = oldAspect < newAspect ? Math.round((source.height - source.height * (oldAspect / newAspect)) / 2) : 0;
  const keptWidth = source.width - 2 * cropX;
  const keptHeight = source.height - 2 * cropY;
  const x = ((point.x * source.width - cropX) / keptWidth) * target.width;
  const y = ((point.y * source.height - cropY) / keptHeight) * target.height;
  if (x < 0 || y < 0 || x > target.width || y > target.height) return null;
  return { x: Math.min(target.width - 1, Math.round(x)), y: Math.min(target.height - 1, Math.round(y)) };
}

function validPoints(points: readonly SwapPoint[] | undefined, label: string): readonly SwapPoint[] {
  const list = points ?? [];
  if (list.length > MAX_SWAP_POINTS) throw new CompileError(`${list.length} ${label}, over the ${MAX_SWAP_POINTS} a swap takes`);
  for (const point of list) {
    if (!(Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) {
      throw new CompileError(`a ${label.replace(/s$/, '')} is not a fraction of the frame: ${JSON.stringify(point)}`);
    }
  }
  return list;
}

/**
 * An object swap (SAM 2.1, then Wan 2.1 VACE 14B): the object the points mark on the clip's first
 * frame is followed through the clip, painted grey with a small margin, and redrawn from the text,
 * and the photo of the new object when there is one; everything else stays as it was filmed. At
 * 480p and 16 fps, over the clip's first 5 s (4n+1 frames, 81 at most).
 */
export function compileSwap(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: SwapInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; seed: number; prompt: string; points: number; excluded: number; reference: boolean }> {
  if (model.task !== 'v2v-swap') throw new CompileError(`model ${model.id} runs task ${model.task}, not v2v-swap`);
  requireNodes(model, template, Object.values(SWAP_NODES));
  const { min_duration_s: shortest = 1, max_duration_s: longest = 30, max_chars } = model.limits;
  // the prepared clip of a 5 s source may probe a few milliseconds over 5 s
  if (!(inputs.video_s >= shortest && inputs.video_s <= longest + 0.05)) {
    throw new CompileError(`the clip lasts ${inputs.video_s} s; a swap takes ${shortest} to ${longest} s`);
  }
  const prompt = inputs.prompt.trim();
  if (!prompt) throw new CompileError('the swap text is empty');
  if (max_chars !== undefined && prompt.length > max_chars) {
    throw new CompileError(`the swap text has ${prompt.length} characters, over the ${max_chars} of model ${model.id}`);
  }
  if (!(inputs.source.width > 0 && inputs.source.height > 0)) throw new CompileError('the clip has no frame size');
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const target = { width, height };
  if (inputs.points.length === 0) throw new CompileError('a swap needs at least one point on the object');
  const kept = (list: readonly SwapPoint[]) => list.map((point) => framePoint(point, inputs.source, target)).filter((point) => point !== null);
  const points = kept(validPoints(inputs.points, 'points'));
  const exclude = kept(validPoints(inputs.exclude, 'excluded points'));
  if (points.length === 0) throw new CompileError(`the object's points are all outside the part of the frame a ${inputs.aspect} video keeps`);
  const available = Math.floor(inputs.video_s * SWAP_FPS);
  const frames = Math.min(MAX_FRAMES, 4 * Math.ceil((available - 1) / 4) + 1);
  const workflow = bindExtension(model, template, {
    video: inputs.videoRef,
    image: inputs.imageRef,
    prompt,
    seed: inputs.seed,
    width,
    height,
    frames,
    points: JSON.stringify(points),
    ...(exclude.length > 0 ? { exclude_points: JSON.stringify(exclude) } : {}),
  });
  // The tracker reads an empty list as a point with no coordinates: no excluded point, no input.
  if (exclude.length === 0) delete workflow[SWAP_NODES.points]!.inputs.coordinates_negative;
  if (!inputs.imageRef) for (const id of [SWAP_NODES.reference, SWAP_NODES.referenceFitted]) dropNode(workflow, id);
  return {
    workflow,
    output: { ...model.output },
    params: { width, height, frames, seed: inputs.seed, prompt, points: points.length, excluded: exclude.length, reference: Boolean(inputs.imageRef) },
  };
}
