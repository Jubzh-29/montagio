import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileUpscale, type Aspect } from '@montagio/presets';
import { JobError } from '../errors';
import { requireExtension, upscaleModel } from '../extensions';
import { getGeneration, mediaFileFor } from '../generations';
import { jobs, type TaskDef } from '../jobs';
import { extensionFile } from './files';

/** The finished clip an HD job starts from: a camera generation, or a clip-making job (effect, hook, avatar). */
async function parentClip(parent: unknown): Promise<{ source: 'generation' | 'job'; id: string; url: string; frames?: number; aspect: Aspect; name?: string } | null> {
  const { source, id } = (parent ?? {}) as { source?: unknown; id?: unknown };
  if (typeof id !== 'string') return null;
  if (source === 'generation') {
    const record = await getGeneration(id);
    if (record?.state !== 'succeeded' || !record.outputUrl) return null;
    return { source, id, url: record.outputUrl, aspect: record.aspect, ...(record.frames !== undefined ? { frames: record.frames } : {}) };
  }
  if (source === 'job') {
    const record = await jobs.read(id);
    if (record?.state !== 'succeeded' || !record.outputUrl?.endsWith('.mp4') || record.task === 'music' || record.task === 'upscale') return null;
    return { source, id, url: record.outputUrl, aspect: record.aspect ?? '16:9', ...(record.frames !== undefined ? { frames: record.frames } : {}) };
  }
  return null;
}

/**
 * A finished clip to 1080p (SeedVR2): same aspect and frame count, 121 frames at most, so
 * a clip whose frame count is unknown (delivered before it was recorded) is refused too.
 * `smooth: true` adds RIFE frames in between: twice the frame rate (16 to 32 fps), same length.
 */
export const upscaleTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('upscale');
    const clip = await parentClip(body.parent);
    const model = upscaleModel(lib);
    const max = model.limits.max_input_frames ?? Infinity;
    if (!clip || clip.frames === undefined || clip.frames > max) throw new JobError('invalid-input');
    return {
      inputs: { clipUrl: clip.url, frames: clip.frames, smooth: body.smooth === true },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: clip.aspect,
      parent: { source: clip.source, id: clip.id },
    };
  },

  steps: (record, lib) => [
    {
      name: 'upscale',
      presetId: 'upscale',
      extension: 'upscale',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        const clip = mediaFileFor(String(record.inputs.clipUrl));
        if (!template || !clip) throw new Error(`HD: no workflow for ${model.id}, or the clip is gone`);
        const { workflow, output } = compileUpscale(model, template, {
          videoRef: basename(clip),
          aspect: record.aspect ?? '16:9',
          seed: record.seed,
          frames: Number(record.inputs.frames),
          smooth: record.inputs.smooth === true,
        });
        return { workflow, output, files: [extensionFile(model, 'video', clip)] };
      },
    },
  ],
};
