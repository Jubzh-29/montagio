import type { BindingKey, ModelEntry } from '@montagio/registry';
import { dimensionsFor, frameCount, type Aspect, type Resolution } from './dimensions';
import type { CameraPose, Preset } from './schema';

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export type JobInputs = {
  imageRef?: string;
  userPrompt?: string;
  seed: number;
  aspect: Aspect;
  resolution?: Resolution;
  duration_s?: number;
  fps?: 16 | 24;
};

export type CompiledParams = {
  width: number;
  height: number;
  frames: number;
  fps: 16 | 24;
  resolution: Resolution;
  duration_s: number;
  prompt: string;
  negative: string;
  seed: number;
  cameraPose: string | null;
  cameraSpeed: number | null;
  cameraMode: 'parametric' | 'prompt';
};

/**
 * Values expected by the camera node. Provisional: confirmed against the real
 * Wan 2.2 Fun-Camera node after GPU session S1 (plan 2).
 */
export const CAMERA_POSE_VALUES: Record<CameraPose, string> = {
  static: 'Static',
  pan_left: 'Pan Left',
  pan_right: 'Pan Right',
  pan_up: 'Pan Up',
  pan_down: 'Pan Down',
  zoom_in: 'Zoom In',
  zoom_out: 'Zoom Out',
};

/** Degraded mode for models without parametric camera control. */
export const CAMERA_POSE_PROMPTS: Record<CameraPose, string> = {
  static: 'static locked-off camera',
  pan_left: 'the camera pans left',
  pan_right: 'the camera pans right',
  pan_up: 'the camera tilts up',
  pan_down: 'the camera tilts down',
  zoom_in: 'the camera pushes in toward the subject',
  zoom_out: 'the camera pulls back from the subject',
};

export class CompileError extends Error {
  override name = 'CompileError';
}

/**
 * Preset defaults adapt to what the model can render; values the caller asked
 * for explicitly are validated strictly.
 */
function pick<T>(explicit: T | undefined, fallback: T, allowed: readonly T[], label: string, modelId: string): T {
  if (explicit !== undefined) {
    if (!allowed.includes(explicit)) {
      throw new CompileError(`${label} ${String(explicit)} is not supported by model ${modelId} (allowed: ${allowed.join(', ')})`);
    }
    return explicit;
  }
  return allowed.includes(fallback) ? fallback : (allowed[0] as T);
}

export function compileJob(
  preset: Preset,
  model: ModelEntry,
  template: ApiWorkflow,
  inputs: JobInputs,
): { workflow: ApiWorkflow; params: CompiledParams } {
  let cameraMode: CompiledParams['cameraMode'];
  if (model.capabilities.includes('i2v-camera')) cameraMode = 'parametric';
  else if (model.capabilities.includes('i2v')) cameraMode = 'prompt';
  else throw new CompileError(`model ${model.id} cannot render capability ${preset.capability}`);

  if (!inputs.imageRef) throw new CompileError(`preset ${preset.id} needs a start image (imageRef)`);

  const resolution = pick(inputs.resolution, preset.defaults.resolution, model.limits.resolutions, 'resolution', model.id);
  const fps = pick(inputs.fps, preset.defaults.fps, model.limits.fps, 'fps', model.id);
  const duration_s = inputs.duration_s ?? Math.min(preset.defaults.duration_s, model.limits.max_duration_s);
  if (duration_s > model.limits.max_duration_s) {
    throw new CompileError(`duration ${duration_s}s exceeds the ${model.limits.max_duration_s}s limit of model ${model.id}`);
  }

  const { width, height } = dimensionsFor(inputs.aspect, resolution);
  const frames = frameCount(duration_s, fps);
  const poses = preset.camera.poses;
  const promptParts = [inputs.userPrompt?.trim(), preset.prompt.suffix.trim()];
  if (cameraMode === 'prompt') promptParts.push(poses.map((pose) => CAMERA_POSE_PROMPTS[pose]).join(', '));
  const prompt = promptParts.filter((part): part is string => Boolean(part)).join(', ');

  const params: CompiledParams = {
    width,
    height,
    frames,
    fps,
    resolution,
    duration_s,
    prompt,
    negative: preset.prompt.negative,
    seed: inputs.seed,
    cameraPose: cameraMode === 'parametric' ? poses.map((pose) => CAMERA_POSE_VALUES[pose]).join(' + ') : null,
    cameraSpeed: cameraMode === 'parametric' ? preset.camera.speed : null,
    cameraMode,
  };

  const values: Partial<Record<BindingKey, unknown>> = {
    image: inputs.imageRef,
    prompt: params.prompt,
    negative: params.negative,
    seed: params.seed,
    width,
    height,
    frames,
    fps,
    camera_pose: params.cameraPose,
    camera_speed: params.cameraSpeed,
  };

  const workflow = structuredClone(template);
  const missing = new Map<string, BindingKey[]>();
  for (const [key, binding] of Object.entries(model.bindings) as [BindingKey, { node: string; field: string }][]) {
    if (cameraMode === 'prompt' && (key === 'camera_pose' || key === 'camera_speed')) continue;
    const node = workflow[binding.node];
    if (!node) {
      missing.set(binding.node, [...(missing.get(binding.node) ?? []), key]);
      continue;
    }
    node.inputs[binding.field] = values[key];
  }
  if (missing.size > 0) {
    const details = [...missing].map(([node, keys]) => `${keys.join(', ')} → node ${node}`).join('; ');
    throw new CompileError(`bindings not found in the workflow template of ${model.id}: ${details}`);
  }
  return { workflow, params };
}
