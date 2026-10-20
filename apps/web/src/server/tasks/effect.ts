import { randomInt } from 'node:crypto';
import { compileEffect } from '@montagio/presets';
import { JobError } from '../errors';
import { visibleEffects } from '../extensions';
import { assertConsent, assertNoBlockedName } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const SUBJECT_MAX = 120;

/**
 * A one-photo effect of the pack (Wan 2.1 I2V 480p with the effect's LoRA). The subject says
 * what the photo shows; left empty, the preset's own default fills the prompt: no text to write.
 */
export const effectTask: TaskDef = {
  async prepare(body, lib) {
    const preset = (await visibleEffects()).find((effect) => effect.id === body.effectId);
    if (!preset) throw new JobError('extension-disabled');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const model = lib.extensionModels.get(preset.models.preferred);
    if (!model) throw new Error(`effect ${preset.id}: unknown model ${preset.models.preferred}`);
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (subject.length > (model.limits.max_chars ?? SUBJECT_MAX)) throw new JobError('invalid-input');
    assertConsent(photo, body.consent);
    await assertNoBlockedName(subject);
    return {
      inputs: { imageRef, effectId: preset.id, subject, personal: photo.personal },
      label: { itemId: preset.id, name: preset.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'effect',
      presetId: String(record.inputs.effectId),
      extension: 'effects',
      compile: async () => {
        const preset = lib.effects.get(String(record.inputs.effectId));
        const model = lib.extensionModels.get(record.modelId);
        const template = model && lib.extensionTemplates.get(model.workflow);
        if (!preset || !model || !template) throw new Error(`effect ${String(record.inputs.effectId)} cannot be compiled here`);
        const imageRef = String(record.inputs.imageRef);
        const subject = String(record.inputs.subject ?? '');
        const { workflow, output } = compileEffect(
          preset,
          model,
          template,
          { imageRef, ...(subject ? { subject } : {}), seed: record.seed, aspect: record.aspect ?? '16:9', fast: preset.defaults.fast },
          lib.lock,
        );
        return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef))] };
      },
    },
  ],
};
