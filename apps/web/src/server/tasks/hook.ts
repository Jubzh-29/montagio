import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileHookEdit, compileHookTransition, type Library, type TransitionPreset } from '@montagio/presets';
import { JobError } from '../errors';
import { visibleHooks } from '../extensions';
import { assertConsent } from '../guards';
import type { JobRecord, TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

function hookOf(lib: Library, record: JobRecord): TransitionPreset {
  const hook = lib.hooks.get(String(record.inputs.hookId));
  if (!hook) throw new Error(`hook ${String(record.inputs.hookId)} cannot be compiled here`);
  return hook;
}

/**
 * A one-photo hook: the edit makes the end frame from the photo (and the outfit of a
 * two-reference hook), then the keyframe transition animates the passage from the photo.
 * No text to write; either photo being personal asks for consent.
 */
export const hookTask: TaskDef = {
  async prepare(body) {
    const hook = (await visibleHooks()).find((entry) => entry.id === body.hookId);
    if (!hook) throw new JobError('extension-disabled');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const two = hook.end_frame.references === 2;
    const image2Ref = two && typeof body.image2Ref === 'string' ? body.image2Ref : '';
    const outfit = two ? await readUploadMeta(image2Ref) : null;
    if (two && !outfit) throw new JobError('invalid-input');
    assertConsent(photo, body.consent);
    if (outfit) assertConsent(outfit, body.consent);
    return {
      inputs: { imageRef, ...(outfit ? { image2Ref } : {}), hookId: hook.id, personal: photo.personal || outfit?.personal === true },
      label: { itemId: hook.id, name: hook.name },
      modelId: hook.models.preferred,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'edit',
      presetId: String(record.inputs.hookId),
      extension: 'edit',
      compile: async () => {
        const hook = hookOf(lib, record);
        const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
        const template = model && lib.extensionTemplates.get(model.workflow);
        if (!model || !template) throw new Error(`hook ${hook.id}: no edit model or workflow`);
        const imageRef = String(record.inputs.imageRef);
        const image2Ref = typeof record.inputs.image2Ref === 'string' ? record.inputs.image2Ref : undefined;
        const { workflow, output } = compileHookEdit(
          hook,
          model,
          template,
          { imageRef, ...(image2Ref ? { image2Ref } : {}), seed: record.seed, fast: hook.defaults.fast },
          lib.lock,
        );
        const files = [extensionFile(model, 'image', uploadPath(imageRef))];
        if (image2Ref) files.push(extensionFile(model, 'image2', uploadPath(image2Ref)));
        return { workflow, output, files };
      },
    },
    {
      name: 'transition',
      presetId: String(record.inputs.hookId),
      extension: 'transitions',
      compile: async (current) => {
        const hook = hookOf(lib, current);
        const model = lib.extensionModels.get(hook.models.preferred);
        const template = model && lib.extensionTemplates.get(model.workflow);
        const end = current.steps[0]?.outputPath;
        if (!model || !template || !end) throw new Error(`hook ${hook.id}: no transition model, workflow or end frame`);
        const imageRef = String(current.inputs.imageRef);
        const { workflow, output } = compileHookTransition(hook, model, template, {
          imageRef,
          endRef: basename(end),
          seed: current.seed,
          aspect: current.aspect ?? '16:9',
          fast: hook.defaults.fast,
        });
        return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef)), extensionFile(model, 'end_image', end)] };
      },
    },
  ],
};
