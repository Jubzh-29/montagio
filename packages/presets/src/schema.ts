import { z } from 'zod';

export const CAMERA_POSES = ['static', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'zoom_in', 'zoom_out'] as const;
export type CameraPose = (typeof CAMERA_POSES)[number];

const kebabId = z.string().max(48).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case (a-z, 0-9, -)');

const CameraSchema = z
  .object({
    poses: z.array(z.enum(CAMERA_POSES)).min(1).max(2),
    speed: z.number().min(0.1).max(3).default(1),
  })
  .strict()
  .superRefine((camera, ctx) => {
    if (new Set(camera.poses).size !== camera.poses.length) {
      ctx.addIssue({ code: 'custom', path: ['poses'], message: 'poses must not repeat' });
    }
    if (camera.poses.includes('static') && camera.poses.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['poses'], message: '"static" cannot be combined with another pose' });
    }
  });

export const PresetSchema = z
  .object({
    schema: z.literal('montagio/preset@0.1'),
    id: kebabId,
    name: z.string().min(1).max(40),
    description: z.string().max(140).default(''),
    preview: z.string().regex(/^previews\/[a-z0-9-]+\.(mp4|webm)$/, 'must look like previews/<id>.mp4'),
    license: z.enum(['CC-BY-4.0', 'CC0-1.0', 'Apache-2.0', 'MIT']),
    author: z.string().min(1).max(60),
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
