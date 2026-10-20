import { randomInt } from 'node:crypto';
import { compileEdit, EDIT_LOOK_IDS, type EditLook, type Library } from '@montagio/presets';
import type { ExtensionModel } from '@montagio/registry';
import { JobError } from '../errors';
import { requireExtension } from '../extensions';
import { assertConsent, assertNoBlockedName } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const INSTRUCTION_MAX = 500;

function editModel(lib: Library): ExtensionModel {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
  if (!model) throw new Error('no i2i-edit model in registry/extensions');
  return model;
}

/**
 * Edit the start photo with an instruction (Qwen-Image-Edit-2511, 4 steps), and an optional
 * look. The result is a new upload, personal when the edited photo was.
 */
export const editTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('edit');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const model = editModel(lib);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction || instruction.length > (model.limits.max_chars ?? INSTRUCTION_MAX)) throw new JobError('invalid-input');
    const look = body.look === undefined || body.look === null ? null : EDIT_LOOK_IDS.find((id) => id === body.look);
    if (look === undefined) throw new JobError('invalid-input');
    assertConsent(photo, body.consent);
    await assertNoBlockedName(instruction);
    return {
      inputs: { imageRef, instruction, look, personal: photo.personal },
      label: { ...(look ? { itemId: look } : {}), name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'edit',
      presetId: 'edit',
      extension: 'edit',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const imageRef = String(record.inputs.imageRef);
        const look = (record.inputs.look as EditLook | null) ?? undefined;
        const { workflow, output } = compileEdit(
          model,
          template,
          { imageRef, instruction: String(record.inputs.instruction), seed: record.seed, fast: true, ...(look ? { look } : {}) },
          lib.lock,
        );
        return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef))] };
      },
    },
  ],

  imageOrigin: async (record) => ({ origin: 'edit', personal: record.inputs.personal === true }),
};
