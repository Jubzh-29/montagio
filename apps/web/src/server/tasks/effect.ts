import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileCompose, compileEffect, COMPOSE_ROLES, type ComposeRefs, type Library } from '@montagio/presets';
import { JobError } from '../errors';
import { requireExtension, visibleEffects } from '../extensions';
import { assertConsent, assertNoBlockedName } from '../guards';
import type { JobRecord, StepPlan, TaskDef } from '../jobs';
import { readUploadMeta, type UploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const SUBJECT_MAX = 120;

/**
 * The references of a composed start photo, two or three of a place, a character and a product,
 * each a known upload; null when the body asks for none.
 */
async function composeOf(raw: unknown): Promise<{ refs: ComposeRefs; metas: UploadMeta[] } | null> {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new JobError('invalid-input');
  const refs: ComposeRefs = {};
  const metas: UploadMeta[] = [];
  for (const role of COMPOSE_ROLES) {
    const ref = (raw as Record<string, unknown>)[role];
    if (ref === undefined || ref === null || ref === '') continue;
    const meta = typeof ref === 'string' ? await readUploadMeta(ref) : null;
    if (!meta) throw new JobError('unknown-image');
    refs[role] = meta.imageRef;
    metas.push(meta);
  }
  if (metas.length < 2) throw new JobError('invalid-input');
  return { refs, metas };
}

function editModelOf(lib: Library) {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
  const template = model && lib.extensionTemplates.get(model.workflow);
  if (!model || !template) throw new Error('no edit model or workflow for a composed start photo');
  return { model, template };
}

/** The composition step: the edit puts the place, the character and the product in one photo. */
function composeStep(record: JobRecord, lib: Library): StepPlan {
  return {
    name: 'compose',
    presetId: 'compose',
    extension: 'edit',
    compile: async () => {
      const { model, template } = editModelOf(lib);
      const refs = record.inputs.compose as ComposeRefs;
      const { workflow, output, order } = compileCompose(model, template, { refs, seed: record.seed, fast: true }, lib.lock);
      const keys = ['image', 'image2', 'image3'] as const;
      return { workflow, output, files: order.map((role, index) => extensionFile(model, keys[index]!, uploadPath(refs[role]!))) };
    },
  };
}

/**
 * A one-photo effect of the pack (Wan 2.1 I2V 480p with the effect's LoRA). The subject says
 * what the photo shows; left empty, the preset's own default fills the prompt: no text to write.
 */
export const effectTask: TaskDef = {
  async prepare(body, lib) {
    const preset = (await visibleEffects()).find((effect) => effect.id === body.effectId);
    if (!preset) throw new JobError('extension-disabled');
    // A composed start photo (place, character, product) needs the edit; its first reference is the photo of record.
    const compose = await composeOf(body.compose);
    if (compose) await requireExtension('edit');
    const imageRef = compose ? compose.metas[0]!.imageRef : typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const model = lib.extensionModels.get(preset.models.preferred);
    if (!model) throw new Error(`effect ${preset.id}: unknown model ${preset.models.preferred}`);
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (subject.length > (model.limits.max_chars ?? SUBJECT_MAX)) throw new JobError('invalid-input');
    // Every reference someone imported asks for consent, as both photos of a hook do.
    for (const meta of compose?.metas ?? [photo]) assertConsent(meta, body.consent);
    await assertNoBlockedName(subject);
    const personal = (compose?.metas ?? [photo]).some((meta) => meta.personal);
    return {
      inputs: { imageRef, effectId: preset.id, subject, personal, ...(compose ? { compose: compose.refs } : {}) },
      label: { itemId: preset.id, name: preset.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    ...(record.inputs.compose ? [composeStep(record, lib)] : []),
    {
      name: 'effect',
      presetId: String(record.inputs.effectId),
      extension: 'effects',
      compile: async (current) => {
        const preset = lib.effects.get(String(record.inputs.effectId));
        const model = lib.extensionModels.get(record.modelId);
        const template = model && lib.extensionTemplates.get(model.workflow);
        if (!preset || !model || !template) throw new Error(`effect ${String(record.inputs.effectId)} cannot be compiled here`);
        // After a composition the effect starts on the composed photo, the first step's output.
        const composed = current.inputs.compose ? current.steps[0]?.outputPath : undefined;
        if (current.inputs.compose && !composed) throw new Error('the composed start photo is missing');
        const imageRef = composed ? basename(composed) : String(record.inputs.imageRef);
        const subject = String(record.inputs.subject ?? '');
        const { workflow, output } = compileEffect(
          preset,
          model,
          template,
          { imageRef, ...(subject ? { subject } : {}), seed: record.seed, aspect: record.aspect ?? '16:9', fast: preset.defaults.fast },
          lib.lock,
        );
        return { workflow, output, files: [extensionFile(model, 'image', composed ?? uploadPath(imageRef))] };
      },
    },
  ],
};
