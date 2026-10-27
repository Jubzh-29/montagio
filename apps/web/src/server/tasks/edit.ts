import { randomInt } from 'node:crypto';
import { compileEdit, EDIT_LOOK_IDS, type EditLook, type Library } from '@montagio/presets';
import type { ExtensionModel } from '@montagio/registry';
import { JobError } from '../errors';
import { requireExperimental, requireExtension } from '../extensions';
import { assertConsent, assertAllowedText } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta, type UploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const INSTRUCTION_MAX = 500;
const SCENE_MAX = 500;

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
    // Inpaint: a mask painted in the browser (white where the photo changes), uploaded like a photo.
    let maskRef: string | undefined;
    if (body.maskRef !== undefined && body.maskRef !== null) {
      const mask = typeof body.maskRef === 'string' ? await readUploadMeta(body.maskRef) : null;
      if (!mask) throw new JobError('unknown-image');
      if (mask.aspect !== photo.aspect) throw new JobError('invalid-input');
      maskRef = mask.imageRef;
    }
    // A second photo the edit reads (Change palette: its colors), a known upload; not with an inpaint.
    let second: UploadMeta | null = null;
    if (body.image2Ref !== undefined && body.image2Ref !== null) {
      // The edit copied the second photo's content, not only its colors (GPU, 2026-10-24): behind the flag.
      requireExperimental('palette-photo');
      second = typeof body.image2Ref === 'string' ? await readUploadMeta(body.image2Ref) : null;
      if (!second) throw new JobError('unknown-image');
      if (maskRef) throw new JobError('invalid-input');
    }
    // What the result shows, when the caller knows it (a character's photodump): the Studio's description later.
    const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, SCENE_MAX) : '';
    for (const meta of second ? [photo, second] : [photo]) assertConsent(meta, body.consent);
    await assertAllowedText(instruction, scene);
    const personal = photo.personal || second?.personal === true;
    const fictional = photo.fictional === true && (!second || second.fictional === true);
    return {
      inputs: {
        imageRef,
        instruction,
        look,
        personal,
        ...(fictional ? { fictional: true } : {}),
        ...(scene ? { scene } : {}),
        ...(maskRef ? { maskRef } : {}),
        ...(second ? { image2Ref: second.imageRef } : {}),
      },
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
        const maskRef = typeof record.inputs.maskRef === 'string' ? record.inputs.maskRef : undefined;
        const image2Ref = typeof record.inputs.image2Ref === 'string' ? record.inputs.image2Ref : undefined;
        const { workflow, output } = compileEdit(
          model,
          template,
          {
            imageRef,
            instruction: String(record.inputs.instruction),
            seed: record.seed,
            fast: true,
            ...(look ? { look } : {}),
            ...(maskRef ? { maskRef } : {}),
            ...(image2Ref ? { image2Ref } : {}),
          },
          lib.lock,
        );
        const files = [
          extensionFile(model, 'image', uploadPath(imageRef)),
          ...(maskRef ? [extensionFile(model, 'mask', uploadPath(maskRef))] : []),
          ...(image2Ref ? [extensionFile(model, 'image2', uploadPath(image2Ref))] : []),
        ];
        return { workflow, output, files };
      },
    },
  ],

  imageOrigin: async (record) => ({ origin: 'edit', personal: record.inputs.personal === true, ...(record.inputs.fictional === true ? { fictional: true } : {}) }),
};
