import { z } from 'zod';

/** Weight licenses the official distribution accepts: usable by anyone, anywhere, for any purpose. */
export const ALLOWED_WEIGHT_LICENSES = ['Apache-2.0', 'MIT'] as const;

/**
 * The seven extensions, in their order of priority (reoriented toward one-photo hooks on
 * 2026-10-19; motion transfer added last on 2026-10-20).
 */
export const EXTENSION_IDS = ['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion'] as const;
export type ExtensionId = (typeof EXTENSION_IDS)[number];

export const CAPABILITIES = ['i2v-camera', 'i2v', 't2i'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const BINDING_KEYS = [
  'image',
  'prompt',
  'negative',
  'seed',
  'width',
  'height',
  'frames',
  'fps',
  'camera_pose',
  'camera_speed',
] as const;
export type BindingKey = (typeof BINDING_KEYS)[number];

export const REQUIRED_BINDINGS: Record<Capability, BindingKey[]> = {
  'i2v-camera': ['image', 'prompt', 'negative', 'seed', 'width', 'height', 'frames', 'camera_pose', 'camera_speed'],
  i2v: ['image', 'prompt', 'negative', 'seed', 'width', 'height', 'frames'],
  t2i: ['prompt', 'seed', 'width', 'height'],
};

export const kebabId = z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case (a-z, 0-9, -)');
const resolution = z.enum(['480p', '720p']);
const binding = z.object({ node: z.string().min(1), field: z.string().min(1) }).strict();

export const ModelSchema = z
  .object({
    schema: z.literal('montagio/model@0.1'),
    id: kebabId,
    name: z.string().min(1).max(60),
    kind: z.enum(['video', 'image']),
    /** quality: every step; turbo: the same model in a few distilled steps; fast: a smaller model. */
    tier: z.enum(['quality', 'turbo', 'fast']),
    capabilities: z.array(z.enum(CAPABILITIES)).min(1),
    license: z.enum(ALLOWED_WEIGHT_LICENSES),
    weights: z.array(kebabId).min(1),
    workflow: z.string().regex(/^workflows\/[a-z0-9-]+\.api\.json$/, 'workflow must be workflows/<name>.api.json'),
    bindings: z.partialRecord(z.enum(BINDING_KEYS), binding),
    limits: z
      .object({
        resolutions: z.array(resolution).min(1),
        fps: z.array(z.union([z.literal(16), z.literal(24)])).min(1),
        max_duration_s: z.number().int().min(1).max(30),
      })
      .strict(),
    estimate_s: z
      .object({ '480p': z.number().positive(), '720p': z.number().positive().optional() })
      .strict(),
  })
  .strict()
  .superRefine((model, ctx) => {
    for (const capability of model.capabilities) {
      for (const key of REQUIRED_BINDINGS[capability]) {
        if (!model.bindings[key]) {
          ctx.addIssue({
            code: 'custom',
            path: ['bindings', key],
            message: `binding "${key}" is required by capability "${capability}"`,
          });
        }
      }
    }
  });

export type ModelEntry = z.infer<typeof ModelSchema>;

export const LockEntrySchema = z
  .object({
    id: kebabId,
    file: z.string().min(1),
    url: z.string().startsWith('https://huggingface.co/', 'url must point to https://huggingface.co/'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters').optional(),
    /** Git blob id of a small file Hugging Face keeps out of LFS, and so publishes no sha256 for. */
    git_sha1: z.string().regex(/^[a-f0-9]{40}$/, 'git_sha1 must be 40 lowercase hex characters').optional(),
    /** Size of the file in bytes, as Hugging Face publishes it. */
    size: z.number().int('size must be a whole number of bytes').positive('size must be a positive number of bytes').optional(),
    license: z.string().min(1),
    source: z.string().url(),
    /** The extension this weight serves; absent for the weights of the camera presets. */
    extension: z.enum(EXTENSION_IDS).optional(),
    /** Folder under ComfyUI's models/, when the URL does not end in <folder>/<file>. */
    folder: z
      .string()
      .regex(/^[a-z0-9_]+(\/[A-Za-z0-9._-]+)*$/, 'folder must be a relative path under models/, such as tts/chatterbox/<pack>')
      .refine((folder) => folder.split('/').every((part) => part !== '.' && part !== '..'), 'folder must not contain . or ..')
      .optional(),
  })
  .strict();

export type LockEntry = z.infer<typeof LockEntrySchema>;

export const LockSchema = z
  .object({
    schema: z.literal('montagio/lock@0.1'),
    weights: z.array(LockEntrySchema).min(1),
  })
  .strict()
  .superRefine((lock, ctx) => {
    const seen = new Set<string>();
    lock.weights.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: ['weights', index, 'id'], message: `duplicate weight id "${entry.id}"` });
      }
      seen.add(entry.id);
    });
  });
