import type { ModelEntry } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect, type Resolution } from './dimensions';

export type ImageInputs = { prompt: string; seed: number; aspect: Aspect; resolution?: Resolution };
export type ImageParams = { width: number; height: number; prompt: string; seed: number; resolution: Resolution };

/** The longest text a text-to-image job takes. */
export const IMAGE_PROMPT_MAX = 500;

/**
 * Text to image (capability t2i, Z-Image-Turbo at launch): the start photo of a shot,
 * at the size the video models render natively for its aspect (720p by default).
 */
export function compileImage(
  model: ModelEntry,
  template: ApiWorkflow,
  inputs: ImageInputs,
): { workflow: ApiWorkflow; output: { kind: 'image'; node: string }; params: ImageParams } {
  if (!model.capabilities.includes('t2i')) throw new CompileError(`model ${model.id} cannot render capability t2i`);
  const prompt = inputs.prompt.trim();
  if (!prompt) throw new CompileError('a text-to-image job needs a text');
  if (prompt.length > IMAGE_PROMPT_MAX) throw new CompileError(`the text is longer than ${IMAGE_PROMPT_MAX} characters`);
  const resolution = inputs.resolution ?? '720p';
  if (!model.limits.resolutions.includes(resolution)) {
    throw new CompileError(`resolution ${resolution} is not supported by model ${model.id} (allowed: ${model.limits.resolutions.join(', ')})`);
  }
  const savers = Object.entries(template).filter(([, node]) => node.class_type.startsWith('SaveImage'));
  if (savers.length !== 1) {
    throw new CompileError(`the workflow of ${model.id} must have one SaveImage node, it has ${savers.length}`);
  }

  const { width, height } = dimensionsFor(inputs.aspect, resolution);
  const params: ImageParams = { width, height, prompt, seed: inputs.seed, resolution };
  const values: Record<string, unknown> = { prompt, seed: inputs.seed, width, height };
  const workflow = structuredClone(template);
  for (const [key, binding] of Object.entries(model.bindings)) {
    if (!binding || !(key in values)) continue;
    const node = workflow[binding.node];
    if (!node) throw new CompileError(`binding ${key} → node ${binding.node} not found in the workflow template of ${model.id}`);
    node.inputs[binding.field] = values[key];
  }
  return { workflow, output: { kind: 'image', node: savers[0]![0] }, params };
}
