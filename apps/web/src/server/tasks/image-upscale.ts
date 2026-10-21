import { randomInt } from 'node:crypto';
import { compileImageUpscale } from '@montagio/presets';
import { JobError } from '../errors';
import { imageUpscaleModel, requireExtension } from '../extensions';
import type { TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

/**
 * A photo to HD (SeedVR2 on one frame, 2560 px on the long side). It changes no one's
 * likeness, so it asks for no consent, as the HD of a clip; the result keeps the photo's provenance.
 */
export const imageUpscaleTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('upscale');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const model = imageUpscaleModel(lib);
    return {
      inputs: { imageRef, origin: photo.origin, personal: photo.personal, ...(photo.fictional ? { fictional: true } : {}) },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'upscale-image',
      presetId: 'upscale-image',
      extension: 'upscale',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const imageRef = String(record.inputs.imageRef);
        const { workflow, output } = compileImageUpscale(model, template, { imageRef, aspect: record.aspect ?? '16:9', seed: record.seed });
        return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef))] };
      },
    },
  ],

  imageOrigin: async (record) => ({
    origin: (record.inputs.origin as 'upload' | 'sample' | 't2i' | 'edit' | 'frame' | undefined) ?? 'edit',
    personal: record.inputs.personal === true,
    ...(record.inputs.fictional === true ? { fictional: true } : {}),
  }),
};
