import { z } from 'zod';

export const CAMERA_POSES = ['static', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'zoom_in', 'zoom_out', 'roll_ccw', 'roll_cw'] as const;
export type CameraPose = (typeof CAMERA_POSES)[number];

/** How two moves combine: both at once over the whole clip, or the first then the second. */
export const CAMERA_COMBINES = ['together', 'then'] as const;
export type CameraCombine = (typeof CAMERA_COMBINES)[number];

/** Moves whose camera vectors are exact opposites: together, they cancel out to a still camera. */
const OPPOSITE_POSES: Partial<Record<CameraPose, CameraPose>> = {
  zoom_in: 'zoom_out',
  zoom_out: 'zoom_in',
  pan_left: 'pan_right',
  pan_right: 'pan_left',
  pan_up: 'pan_down',
  pan_down: 'pan_up',
  roll_ccw: 'roll_cw',
  roll_cw: 'roll_ccw',
};

const kebabId = z.string().max(48).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case (a-z, 0-9, -)');

const CameraSchema = z
  .object({
    poses: z.array(z.enum(CAMERA_POSES)).min(1).max(2),
    speed: z.number().min(0.1).max(3).default(1),
    combine: z.enum(CAMERA_COMBINES).default('together'),
  })
  .strict()
  .superRefine((camera, ctx) => {
    if (new Set(camera.poses).size !== camera.poses.length) {
      ctx.addIssue({ code: 'custom', path: ['poses'], message: 'poses must not repeat' });
    }
    // "static" at the same time as a move adds nothing; before or after one, it is a hold
    if (camera.poses.includes('static') && camera.poses.length > 1 && camera.combine !== 'then') {
      ctx.addIssue({ code: 'custom', path: ['poses'], message: '"static" can only be combined with another pose when combine is "then"' });
    }
    const [a, b] = camera.poses;
    if (b && OPPOSITE_POSES[a!] === b && camera.combine !== 'then') {
      ctx.addIssue({ code: 'custom', path: ['poses'], message: `"${a}" and "${b}" cancel out when combine is "together"; use combine: "then"` });
    }
  });

/** The fields every kind of preset shares (camera move, one-photo effect, keyframe transition). */
const presetHeader = {
  schema: z.literal('montagio/preset@0.1'),
  id: kebabId,
  name: z.string().min(1).max(40),
  description: z.string().max(140).default(''),
  preview: z.string().regex(/^previews\/[a-z0-9-]+\.(mp4|webm)$/, 'must look like previews/<id>.mp4'),
  license: z.enum(['CC-BY-4.0', 'CC0-1.0', 'Apache-2.0', 'MIT']),
  author: z.string().min(1).max(60),
};

export const PresetSchema = z
  .object({
    ...presetHeader,
    capability: z.literal('i2v-camera'),
    camera: CameraSchema,
    prompt: z
      .object({
        suffix: z.string().max(300).default(''),
        negative: z.string().max(300).default(''),
      })
      .strict()
      .default({ suffix: '', negative: '' }),
    defaults: z
      .object({
        duration_s: z.number().int().min(2).max(10).default(5),
        resolution: z.enum(['480p', '720p']).default('480p'),
        fps: z.union([z.literal(16), z.literal(24)]).default(16),
      })
      .strict()
      .default({ duration_s: 5, resolution: '480p', fps: 16 }),
    models: z
      .object({
        preferred: kebabId,
        fallback: kebabId.optional(),
      })
      .strict(),
    loras: z
      .array(
        z
          .object({
            file: z.string().regex(/\.safetensors$/, 'must be a .safetensors file'),
            strength: z.number().min(0).max(2),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();

export type Preset = z.infer<typeof PresetSchema>;

/**
 * A one-photo effect (`capability: i2v-effect`, in presets/effects/): a LoRA of the effects
 * model, the trigger it was trained on, and a prompt template whose {subject} the user fills
 * ("red toy car"). The template must carry the trigger: the LoRA does nothing without it.
 */
export const EffectPresetSchema = z
  .object({
    ...presetHeader,
    capability: z.literal('i2v-effect'),
    effect: z
      .object({
        /** Lock entry of the LoRA; a weight of the effects model. */
        lora: kebabId,
        strength: z.number().min(0).max(2).default(1),
        trigger: z.string().min(1).max(80),
      })
      .strict(),
    prompt: z
      .object({
        template: z.string().min(1).max(600),
        /** What {subject} becomes when the user names nothing. */
        subject: z.string().min(1).max(60).default('subject'),
        /** Empty keeps the workflow's negative prompt. */
        negative: z.string().max(300).default(''),
      })
      .strict(),
    defaults: z
      .object({ duration_s: z.number().int().min(2).max(5).default(5) })
      .strict()
      .default({ duration_s: 5 }),
    models: z.object({ preferred: kebabId }).strict(),
  })
  .strict()
  .superRefine((preset, ctx) => {
    if (!preset.prompt.template.includes(preset.effect.trigger)) {
      ctx.addIssue({ code: 'custom', path: ['prompt', 'template'], message: `must contain the trigger "${preset.effect.trigger}"` });
    }
    if (!preset.prompt.template.includes('{subject}')) {
      ctx.addIssue({ code: 'custom', path: ['prompt', 'template'], message: 'must contain {subject}' });
    }
  });

export type EffectPreset = z.infer<typeof EffectPresetSchema>;
