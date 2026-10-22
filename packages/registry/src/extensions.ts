import { z } from 'zod';
import { RegistryError } from './errors';
import { ALLOWED_WEIGHT_LICENSES, EXTENSION_IDS, kebabId, type ExtensionId } from './schema';

/**
 * The extensions (edit, effects, transitions, avatar, music, upscale) run models that are
 * not camera presets: their entries live in registry/extensions/, apart from registry/models/,
 * so nothing that lists preset models (the Studio, the showcase, compileJob) sees them.
 */
export const EXTENSION_TASKS = ['t2a', 'v2v-upscale', 'i2i-upscale', 'i2i-edit', 'tts', 'ia2v-talk', 'i2v-effect', 'flf2v', 'motion-transfer'] as const;
export type ExtensionTask = (typeof EXTENSION_TASKS)[number];

/** What a job delivers (the same three kinds as @montagio/comfy-adapter, which the registry does not depend on). */
export const OUTPUT_KINDS = ['video', 'audio', 'image'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const EXTENSION_BINDING_KEYS = [
  'prompt',
  'duration_s',
  'bpm',
  'seed',
  'image',
  'video',
  'audio',
  'text',
  'language',
  'cfg',
  'width',
  'height',
  'frames',
  'negative',
  'end_image',
  'image2',
  'image3',
  'lora',
  'lora_strength',
  'motion_prompt',
  'mask',
] as const;
export type ExtensionBindingKey = (typeof EXTENSION_BINDING_KEYS)[number];

export const REQUIRED_EXTENSION_BINDINGS: Record<ExtensionTask, ExtensionBindingKey[]> = {
  t2a: ['prompt', 'duration_s', 'seed', 'bpm'],
  'v2v-upscale': ['video', 'width', 'height', 'seed'],
  'i2i-upscale': ['image', 'width', 'height', 'seed'],
  'i2i-edit': ['image', 'prompt', 'seed'],
  tts: ['text', 'language', 'seed', 'cfg'],
  'ia2v-talk': ['image', 'audio', 'prompt', 'seed', 'width', 'height', 'frames'],
  'i2v-effect': ['image', 'prompt', 'negative', 'seed', 'width', 'height', 'frames', 'lora', 'lora_strength'],
  flf2v: ['image', 'end_image', 'prompt', 'negative', 'seed', 'width', 'height', 'frames'],
  'motion-transfer': ['image', 'video', 'prompt', 'motion_prompt', 'negative', 'seed', 'width', 'height', 'frames'],
};

export const TASK_OUTPUT: Record<ExtensionTask, OutputKind> = {
  t2a: 'audio',
  'v2v-upscale': 'video',
  'i2i-upscale': 'image',
  'i2i-edit': 'image',
  tts: 'audio',
  'ia2v-talk': 'video',
  'i2v-effect': 'video',
  flf2v: 'video',
  'motion-transfer': 'video',
};

const binding = z.object({ node: z.string().min(1), field: z.string().min(1) }).strict();
/** One input, or several that take the same value (ACE-Step reads the duration and the seed in two nodes). */
const bindingTargets = z.union([binding, z.array(binding).min(1, 'a binding list needs at least one input')]);

export const ExtensionModelSchema = z
  .object({
    schema: z.literal('montagio/extension-model@0.1'),
    id: kebabId,
    name: z.string().min(1).max(60),
    extension: z.enum(EXTENSION_IDS),
    task: z.enum(EXTENSION_TASKS),
    license: z.enum(ALLOWED_WEIGHT_LICENSES),
    weights: z.array(kebabId).min(1),
    workflow: z.string().regex(/^workflows\/[a-z0-9-]+\.api\.json$/, 'workflow must be workflows/<name>.api.json'),
    bindings: z.partialRecord(z.enum(EXTENSION_BINDING_KEYS), bindingTargets),
    /** The node whose output is the job's result. */
    output: z.object({ node: z.string().min(1), kind: z.enum(OUTPUT_KINDS) }).strict(),
    limits: z
      .object({
        min_duration_s: z.number().positive().optional(),
        max_duration_s: z.number().positive().optional(),
        max_chars: z.number().int().positive().optional(),
        max_input_frames: z.number().int().positive().optional(),
      })
      .strict()
      .default({}),
    /** Seconds of GPU for a typical job, until a GPU session measures it. */
    estimate_s: z.number().positive(),
  })
  .strict()
  .superRefine((model, ctx) => {
    for (const key of REQUIRED_EXTENSION_BINDINGS[model.task]) {
      if (!model.bindings[key]) {
        ctx.addIssue({ code: 'custom', path: ['bindings', key], message: `binding "${key}" is required by task "${model.task}"` });
      }
    }
    const expected = TASK_OUTPUT[model.task];
    if (model.output.kind !== expected) {
      ctx.addIssue({ code: 'custom', path: ['output', 'kind'], message: `task "${model.task}" delivers "${expected}"` });
    }
  });

export type ExtensionModel = z.infer<typeof ExtensionModelSchema>;

const ExtensionEntrySchema = z
  .object({
    id: z.enum(EXTENSION_IDS),
    priority: z.number().int().positive(),
    /** Extensions this one runs on (the transitions make their end frame with the edit). */
    requires: z.array(z.enum(EXTENSION_IDS)).default([]),
    /** The day a GPU session validated the extension; null until then. */
    gpu_validated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'gpu_validated must be a date (YYYY-MM-DD) or null').nullable(),
  })
  .strict();

export type ExtensionEntry = z.infer<typeof ExtensionEntrySchema>;
/** registry/extensions.yaml: the six extensions, each once. */
export type ExtensionsConfig = ExtensionEntry[];

export const ExtensionsConfigSchema = z
  .object({
    schema: z.literal('montagio/extensions@0.1'),
    extensions: z.array(ExtensionEntrySchema),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const id of EXTENSION_IDS) {
      const count = config.extensions.filter((entry) => entry.id === id).length;
      if (count !== 1) {
        ctx.addIssue({ code: 'custom', path: ['extensions'], message: `extension "${id}" must appear once (found ${count})` });
      }
    }
    config.extensions.forEach((entry, index) => {
      if (entry.requires.includes(entry.id)) {
        ctx.addIssue({ code: 'custom', path: ['extensions', index, 'requires'], message: `extension "${entry.id}" cannot require itself` });
      }
    });
    const priorities = config.extensions.map((entry) => entry.priority);
    if (new Set(priorities).size !== priorities.length) {
      ctx.addIssue({ code: 'custom', path: ['extensions'], message: 'two extensions share a priority' });
    }
  });

/**
 * The extensions the app offers, by priority. `flag` is MONTAGIO_EXTENSIONS: unset, empty
 * or "validated" keeps those a GPU session validated (the cut rule decided on 2026-10-19:
 * an extension not validated on GPU by the evening of 25/10 is hidden from the demo), less
 * those whose requirement is not kept; "all" and "none" say what they say; anything else
 * is a comma-separated list of ids, which must also name the requirements of each.
 */
export function enabledExtensions(config: ExtensionsConfig, flag: string | undefined): ExtensionId[] {
  const byPriority = [...config].sort((a, b) => a.priority - b.priority);
  const value = flag?.trim() ?? '';
  if (value === '' || value === 'validated') {
    const kept = new Set(byPriority.filter((entry) => entry.gpu_validated !== null).map((entry) => entry.id));
    for (let changed = true; changed; ) {
      changed = false;
      for (const entry of byPriority) {
        if (kept.has(entry.id) && !entry.requires.every((id) => kept.has(id))) changed = kept.delete(entry.id);
      }
    }
    return byPriority.filter((entry) => kept.has(entry.id)).map((entry) => entry.id);
  }
  if (value === 'all') return byPriority.map((entry) => entry.id);
  if (value === 'none') return [];
  const asked = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = asked.filter((id) => !(EXTENSION_IDS as readonly string[]).includes(id));
  if (unknown.length > 0) {
    throw new RegistryError(
      `MONTAGIO_EXTENSIONS: unknown extension ${unknown.map((id) => JSON.stringify(id)).join(', ')} (expected validated, all, none or a list of ${EXTENSION_IDS.join(', ')})`,
    );
  }
  for (const entry of byPriority.filter((e) => asked.includes(e.id))) {
    const missing = entry.requires.filter((id) => !asked.includes(id));
    if (missing.length > 0) {
      throw new RegistryError(`MONTAGIO_EXTENSIONS: ${entry.id} requires ${missing.join(', ')}; add ${missing.length > 1 ? 'them' : 'it'} to the list`);
    }
  }
  return byPriority.filter((entry) => asked.includes(entry.id)).map((entry) => entry.id);
}
