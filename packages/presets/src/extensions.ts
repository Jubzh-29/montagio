import type { ExtensionBindingKey, ExtensionModel, ExtensionTask, OutputKind } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import type { Aspect } from './dimensions';

/**
 * Compilers of the extension jobs (music, upscale, image edit, voice, talking avatar).
 * Each one checks its inputs against the model's limits, then writes them into a copy
 * of the workflow template through the model's bindings, as compileJob does for presets.
 */

/** A compiled extension job: the workflow, the output node and kind the backend downloads, and what was written. */
export type ExtensionCompiled<P> = { workflow: ApiWorkflow; output: { kind: OutputKind; node: string }; params: P };

type Target = { node: string; field: string };
const targetsOf = (binding: Target | Target[]): Target[] => (Array.isArray(binding) ? binding : [binding]);

/**
 * Copy `template` and write each value into every input its binding names. A binding
 * whose node is not in the template is a CompileError, whether a value was given or not;
 * a bound key without a value keeps the template's.
 */
export function bindExtension(
  model: ExtensionModel,
  template: ApiWorkflow,
  values: Partial<Record<ExtensionBindingKey, unknown>>,
): ApiWorkflow {
  const workflow = structuredClone(template);
  const missing = new Map<string, ExtensionBindingKey[]>();
  for (const [key, binding] of Object.entries(model.bindings) as [ExtensionBindingKey, Target | Target[]][]) {
    for (const target of targetsOf(binding)) {
      const node = workflow[target.node];
      if (!node) {
        missing.set(target.node, [...(missing.get(target.node) ?? []), key]);
        continue;
      }
      if (values[key] !== undefined) node.inputs[target.field] = values[key];
    }
  }
  if (missing.size > 0) {
    const details = [...missing].map(([node, keys]) => `${keys.join(', ')} → node ${node}`).join('; ');
    throw new CompileError(`bindings not found in the workflow template of ${model.id}: ${details}`);
  }
  return workflow;
}

function expectTask(model: ExtensionModel, task: ExtensionTask): void {
  if (model.task !== task) throw new CompileError(`model ${model.id} runs task ${model.task}, not ${task}`);
}

/** A user text, trimmed: never empty, never over the model's `max_chars`. */
function userText(value: string, label: string, model: ExtensionModel): string {
  const text = value.trim();
  if (!text) throw new CompileError(`the ${label} is empty`);
  const max = model.limits.max_chars;
  if (max !== undefined && text.length > max) throw new CompileError(`the ${label} has ${text.length} characters, over the ${max} of model ${model.id}`);
  return text;
}

const DEFAULT_BPM = 90;

export type MusicInputs = {
  /** The music asked for, in words ("tense synth pulse"). */
  prompt: string;
  /** The length of the film the music goes under, in seconds. */
  duration_s: number;
  seed: number;
  /** Tempo, 10 to 300 (90 by default). */
  bpm?: number;
};

/**
 * An instrumental soundtrack (ACE-Step 1.5). The music lasts the film rounded up to the
 * second, and at least the model's `min_duration_s` (ACE-Step documents 10 s and more):
 * the montage cuts it to the film with a fade.
 */
export function compileMusic(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: MusicInputs,
): ExtensionCompiled<{ prompt: string; duration_s: number; seed: number; bpm: number }> {
  expectTask(model, 't2a');
  let prompt = userText(inputs.prompt, 'music description', model);
  if (!/instrumental/i.test(prompt)) prompt = `${prompt}, instrumental`;
  if (!(inputs.duration_s > 0)) throw new CompileError(`a film of ${inputs.duration_s} s gets no music`);
  const duration_s = Math.max(model.limits.min_duration_s ?? 1, Math.ceil(inputs.duration_s));
  const max = model.limits.max_duration_s;
  if (max !== undefined && duration_s > max) {
    throw new CompileError(`a film of ${inputs.duration_s} s is longer than the ${max} s of music model ${model.id} makes`);
  }
  const bpm = inputs.bpm ?? DEFAULT_BPM;
  if (!Number.isInteger(bpm) || bpm < 10 || bpm > 300) throw new CompileError(`bpm ${bpm} is not a whole number from 10 to 300`);
  const workflow = bindExtension(model, template, { prompt, duration_s, seed: inputs.seed, bpm });
  return { workflow, output: { ...model.output }, params: { prompt, duration_s, seed: inputs.seed, bpm } };
}

/** The 1080p size of each aspect: a clip is never stretched to another shape. */
export const UPSCALE_TARGETS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export type UpscaleInputs = {
  /** The clip, as the backend's loader names it once uploaded. */
  videoRef: string;
  /** The aspect of the clip, which picks its 1080p size. */
  aspect: Aspect;
  seed: number;
  /** The clip's frame count, when known: over the model's `max_input_frames` it is refused. */
  frames?: number;
};

/** A finished clip to 1080p (SeedVR2): same aspect, frame rate and frame count, resized then restored. */
export function compileUpscale(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: UpscaleInputs,
): ExtensionCompiled<{ width: number; height: number; seed: number }> {
  expectTask(model, 'v2v-upscale');
  const max = model.limits.max_input_frames;
  if (inputs.frames !== undefined && max !== undefined && inputs.frames > max) {
    throw new CompileError(`a clip of ${inputs.frames} frames is longer than the ${max} frames model ${model.id} upscales`);
  }
  const { width, height } = UPSCALE_TARGETS[inputs.aspect];
  const workflow = bindExtension(model, template, { video: inputs.videoRef, width, height, seed: inputs.seed });
  return { workflow, output: { ...model.output }, params: { width, height, seed: inputs.seed } };
}

export type EditInputs = {
  /** The photo to change, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** What to change, in words ("make it night"). */
  instruction: string;
  seed: number;
};

/** The start photo changed by an instruction (Qwen-Image-Edit-2511); the negative encoder keeps its empty prompt. */
export function compileEdit(model: ExtensionModel, template: ApiWorkflow, inputs: EditInputs): ExtensionCompiled<{ instruction: string; seed: number }> {
  expectTask(model, 'i2i-edit');
  const instruction = userText(inputs.instruction, 'edit instruction', model);
  const workflow = bindExtension(model, template, { image: inputs.imageRef, prompt: instruction, seed: inputs.seed });
  return { workflow, output: { ...model.output }, params: { instruction, seed: inputs.seed } };
}

export type SpeechInputs = {
  /** What the avatar says. */
  text: string;
  language: 'en' | 'fr';
  seed: number;
};

/**
 * Speech for the talking avatar (Chatterbox Multilingual V3), in its built-in voice: no
 * reference clip, so no cloned voice to consent to, and none left in the node's cache.
 * The built-in voice is English: for French, the model card's advice is cfg_weight 0,
 * so its accent does not carry over. Square brackets go (the node reads them as tags);
 * seed 0 means "random" to the node, so it is written as 1.
 */
export function compileSpeech(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: SpeechInputs,
): ExtensionCompiled<{ text: string; language: 'en' | 'fr'; seed: number; cfg: number }> {
  expectTask(model, 'tts');
  const text = userText(inputs.text.replace(/[[\]]/g, ''), 'text to speak', model);
  const cfg = inputs.language === 'fr' ? 0 : 0.5;
  const seed = Math.max(1, inputs.seed);
  const workflow = bindExtension(model, template, { text, language: inputs.language, seed, cfg });
  return { workflow, output: { ...model.output }, params: { text, language: inputs.language, seed, cfg } };
}
