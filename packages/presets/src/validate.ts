import { ALLOWED_WEIGHT_LICENSES } from '@montagio/registry';
import { compileJob, CompileError } from './compile';
import type { Library } from './library';
import { parsePreset, PresetError } from './parse';
import type { Preset } from './schema';

export type PresetValidation = { ok: true; preset: Preset } | { ok: false; problems: string[] };

const ALLOWED = new Set<string>(ALLOWED_WEIGHT_LICENSES);

/**
 * Everything `montagio preset validate` and the Studio remix check: the schema,
 * the models the preset names, the license of its LoRAs, and a dry compile on
 * `opts.modelId` (the model the user picked) or on the preferred and fallback
 * models. Problems are "<path>: <message>" lines, never thrown.
 */
export function validatePreset(
  yamlText: string,
  sourceName: string,
  library: Pick<Library, 'models' | 'templates' | 'lock'>,
  opts: { modelId?: string } = {},
): PresetValidation {
  let preset: Preset;
  try {
    preset = parsePreset(yamlText, sourceName);
  } catch (error) {
    if (error instanceof PresetError) return { ok: false, problems: error.issues };
    throw error;
  }

  const problems: string[] = [];
  for (const [field, id] of [
    ['models.preferred', preset.models.preferred],
    ['models.fallback', preset.models.fallback],
  ] as const) {
    if (id && !library.models.has(id)) problems.push(`${field}: unknown model "${id}"`);
  }

  const lockEntries = [...library.lock.values()];
  preset.loras.forEach((lora, index) => {
    const entry = lockEntries.find((candidate) => candidate.file === lora.file);
    if (!entry) problems.push(`loras[${index}].file: ${lora.file} is not in registry/models.lock.yaml`);
    else if (!ALLOWED.has(entry.license)) {
      problems.push(`loras[${index}].file: license "${entry.license}" is not ${ALLOWED_WEIGHT_LICENSES.join(' or ')}`);
    }
  });

  const targets = opts.modelId
    ? [opts.modelId]
    : [preset.models.preferred, preset.models.fallback].filter((id): id is string => !!id && library.models.has(id));
  for (const modelId of targets) {
    const model = library.models.get(modelId);
    if (!model) {
      problems.push(`model ${modelId}: unknown model`);
      continue;
    }
    const template = library.templates.get(model.workflow);
    if (!template) {
      problems.push(`model ${modelId}: workflow ${model.workflow} is not loaded`);
      continue;
    }
    try {
      compileJob(preset, model, template, { imageRef: 'uploads/validate.png', seed: 0, aspect: '16:9' });
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      problems.push(`model ${modelId}: ${error.message}`);
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, preset };
}
