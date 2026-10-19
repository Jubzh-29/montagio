import type { ExtensionModel, LockEntry } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, frameCount, type Aspect } from './dimensions';
import { bindExtension, bypassNode, requireNodes, type ExtensionCompiled } from './extensions';
import type { EffectPreset } from './schema';

/** Nodes of workflows/wan21-i2v-effect.api.json that compileEffect keeps, removes or rewires. */
const EFFECT_NODES = { speed: '201', sampler: '3' } as const;
/**
 * With the 4-step LoRA of lightx2v (cfg 1), and without it: the effect cards advise 20 steps,
 * cfg 6 and flow shift 5 (the workflow's shift in both cases).
 */
const EFFECT_SAMPLING = {
  fast: { steps: 4, cfg: 1, sampler_name: 'euler' },
  quality: { steps: 20, cfg: 6, sampler_name: 'uni_pc' },
} as const;

export type EffectInputs = {
  /** The photo, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** What the photo shows ("red toy car"); the preset's default subject when absent. */
  subject?: string;
  seed: number;
  aspect: Aspect;
  /** The 4-step LoRA (default), or 20 steps without it. */
  fast?: boolean;
};

/**
 * Why the LoRA an effect names cannot be its effect, or null. It must be a weight of the effects
 * model that ComfyUI finds in models/loras (the lock's `folder`, or the URL's last folder): not
 * the base model, its encoders or VAE, and not the 4-step LoRA the template already loads.
 */
export function effectLoraProblem(
  preset: EffectPreset,
  model: ExtensionModel,
  template: ApiWorkflow | undefined,
  lock: ReadonlyMap<string, LockEntry>,
): string | null {
  const id = preset.effect.lora;
  const entry = lock.get(id);
  if (!entry || !model.weights.includes(id)) return `LoRA "${id}" is not a weight of model ${model.id}`;
  const folder = entry.folder ?? new URL(entry.url).pathname.split('/').at(-2);
  if (folder !== 'loras') return `LoRA "${id}" is not in folder loras (${folder}): it is not a LoRA`;
  if (template?.[EFFECT_NODES.speed]?.inputs.lora_name === entry.file) return `LoRA "${id}" is the 4-step LoRA of model ${model.id}, not an effect`;
  return null;
}

/**
 * A one-photo effect: the preset's LoRA (see effectLoraProblem, its file read from the lock)
 * and its prompt template with the subject, on Wan 2.1 I2V at 480p and 16 fps.
 */
export function compileEffect(
  preset: EffectPreset,
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: EffectInputs,
  lock: ReadonlyMap<string, LockEntry>,
): ExtensionCompiled<{ width: number; height: number; frames: number; prompt: string; seed: number; fast: boolean }> {
  if (model.task !== 'i2v-effect') throw new CompileError(`model ${model.id} runs task ${model.task}, not i2v-effect`);
  if (preset.models.preferred !== model.id) throw new CompileError(`effect ${preset.id} runs on model ${preset.models.preferred}, not ${model.id}`);
  requireNodes(model, template, Object.values(EFFECT_NODES));
  const problem = effectLoraProblem(preset, model, template, lock);
  if (problem) throw new CompileError(`effect ${preset.id}: ${problem}`);
  const lora = lock.get(preset.effect.lora)!;

  const subject = (inputs.subject ?? preset.prompt.subject).trim();
  if (!subject) throw new CompileError('the subject is empty');
  const max = model.limits.max_chars;
  if (max !== undefined && subject.length > max) throw new CompileError(`the subject has ${subject.length} characters, over the ${max} of model ${model.id}`);
  const prompt = preset.prompt.template.replaceAll('{subject}', subject);
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const frames = frameCount(preset.defaults.duration_s, 16);
  const fast = inputs.fast ?? true;

  const workflow = bindExtension(model, template, {
    image: inputs.imageRef,
    prompt,
    negative: preset.prompt.negative || undefined,
    seed: inputs.seed,
    width,
    height,
    frames,
    lora: lora.file,
    lora_strength: preset.effect.strength,
  });
  if (!fast) bypassNode(workflow, EFFECT_NODES.speed);
  Object.assign(workflow[EFFECT_NODES.sampler]!.inputs, fast ? EFFECT_SAMPLING.fast : EFFECT_SAMPLING.quality);
  return { workflow, output: { ...model.output }, params: { width, height, frames, prompt, seed: inputs.seed, fast } };
}
