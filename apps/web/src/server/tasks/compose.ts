import { compileCompose, COMPOSE_ROLES, type ComposeRefs, type ComposeRole, type Library } from '@montagio/presets';
import { JobError } from '../errors';
import type { JobRecord, StepPlan } from '../jobs';
import { readUploadMeta, type UploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

/**
 * The references of a composed photo: two or three of `roles`, each a known upload; null when the
 * body asks for none. `required` must be among them (a motion composes a character).
 */
export async function composeOf(
  raw: unknown,
  roles: readonly ComposeRole[] = COMPOSE_ROLES,
  required?: ComposeRole,
): Promise<{ refs: ComposeRefs; metas: UploadMeta[] } | null> {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new JobError('invalid-input');
  const refs: ComposeRefs = {};
  const metas: UploadMeta[] = [];
  for (const role of COMPOSE_ROLES) {
    const ref = (raw as Record<string, unknown>)[role];
    if (ref === undefined || ref === null || ref === '') continue;
    if (!roles.includes(role)) throw new JobError('invalid-input');
    const meta = typeof ref === 'string' ? await readUploadMeta(ref) : null;
    if (!meta) throw new JobError('unknown-image');
    refs[role] = meta.imageRef;
    metas.push(meta);
  }
  if (metas.length < 2 || metas.length > 3) throw new JobError('invalid-input');
  if (required && !refs[required]) throw new JobError('invalid-input');
  if (refs.outfit && !refs.character) throw new JobError('invalid-input');
  return { refs, metas };
}

function editModelOf(lib: Library) {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
  const template = model && lib.extensionTemplates.get(model.workflow);
  if (!model || !template) throw new Error('no edit model or workflow for a composed photo');
  return { model, template };
}

/**
 * The composition step: the edit puts the references in one photo, the photo the next step
 * animates (`fullBody` for a motion transfer, which needs the whole figure).
 */
export function composeStep(record: JobRecord, lib: Library, opts: { fullBody?: boolean } = {}): StepPlan {
  return {
    name: 'compose',
    presetId: 'compose',
    extension: 'edit',
    compile: async () => {
      const { model, template } = editModelOf(lib);
      const refs = record.inputs.compose as ComposeRefs;
      const { workflow, output, order } = compileCompose(model, template, { refs, seed: record.seed, fast: true, fullBody: opts.fullBody ?? false }, lib.lock);
      const keys = ['image', 'image2', 'image3'] as const;
      return { workflow, output, files: order.map((role, index) => extensionFile(model, keys[index]!, uploadPath(refs[role]!))) };
    },
  };
}
