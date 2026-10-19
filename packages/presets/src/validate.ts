import { ALLOWED_WEIGHT_LICENSES } from '@montagio/registry';
import { parse as parseYaml } from 'yaml';
import { compileJob, CompileError } from './compile';
import { compileEffect, effectLoraProblem } from './effects';
import type { Library } from './library';
import { parseEffectPreset, parsePreset, parseTransitionPreset, PresetError } from './parse';
import type { EffectPreset, Preset, TransitionPreset } from './schema';
import { compileHookEdit, compileHookTransition } from './transitions';

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

export type PresetFileValidation = { ok: true; preset: Preset | EffectPreset | TransitionPreset } | { ok: false; problems: string[] };

type FileLibrary = Pick<Library, 'models' | 'templates' | 'lock' | 'extensionModels' | 'extensionTemplates'>;

/** The photo and the seed of the dry compiles. */
const DRY_RUN = { imageRef: 'uploads/validate.png', seed: 0 } as const;

/** A parse whose schema problems are the result instead of an exception. */
function parsed<T>(parse: () => T): { preset: T } | { problems: string[] } {
  try {
    return { preset: parse() };
  } catch (error) {
    if (error instanceof PresetError) return { problems: error.issues };
    throw error;
  }
}

/** A dry compile on `modelId`: its CompileError as a problem, or none. */
function dryCompile(modelId: string, compile: () => unknown): string[] {
  try {
    compile();
    return [];
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return [`model ${modelId}: ${error.message}`];
  }
}

/**
 * What `montagio preset validate` checks in one file: the schema of the `capability` it names (a
 * camera move as validatePreset checks it, an effect of presets/effects/, a hook of
 * presets/transitions/), the checks the library makes for that kind, and a dry compile.
 * Problems are "<path>: <message>" lines, never thrown.
 */
export function validatePresetFile(yamlText: string, sourceName: string, library: FileLibrary): PresetFileValidation {
  let capability: unknown;
  try {
    capability = (parseYaml(yamlText) as { capability?: unknown } | null)?.capability;
  } catch {
    // validatePreset reports the YAML error
  }
  if (capability === 'i2v-effect') return validateEffect(yamlText, sourceName, library);
  if (capability === 'i2v-transition') return validateHook(yamlText, sourceName, library);
  return validatePreset(yamlText, sourceName, library);
}

function validateEffect(yamlText: string, sourceName: string, library: FileLibrary): PresetFileValidation {
  const read = parsed(() => parseEffectPreset(yamlText, sourceName));
  if ('problems' in read) return { ok: false, problems: read.problems };
  const { preset } = read;
  const model = library.extensionModels.get(preset.models.preferred);
  if (!model) return { ok: false, problems: [`models.preferred: unknown effect model "${preset.models.preferred}"`] };
  if (model.task !== 'i2v-effect') return { ok: false, problems: [`models.preferred: model ${model.id} runs task ${model.task}, not i2v-effect`] };
  const template = library.extensionTemplates.get(model.workflow);
  const lora = effectLoraProblem(preset, model, template, library.lock);
  if (lora) return { ok: false, problems: [`effect.lora: ${lora}`] };
  const license = library.lock.get(preset.effect.lora)!.license;
  if (!ALLOWED.has(license)) return { ok: false, problems: [`effect.lora: license "${license}" is not ${ALLOWED_WEIGHT_LICENSES.join(' or ')}`] };
  if (!template) return { ok: false, problems: [`model ${model.id}: workflow ${model.workflow} is not loaded`] };
  const problems = dryCompile(model.id, () => compileEffect(preset, model, template, { ...DRY_RUN, aspect: '16:9' }, library.lock));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, preset };
}

function validateHook(yamlText: string, sourceName: string, library: FileLibrary): PresetFileValidation {
  const read = parsed(() => parseTransitionPreset(yamlText, sourceName));
  if ('problems' in read) return { ok: false, problems: read.problems };
  const { preset } = read;
  const model = library.extensionModels.get(preset.models.preferred);
  if (!model) return { ok: false, problems: [`models.preferred: unknown transition model "${preset.models.preferred}"`] };
  if (model.task !== 'flf2v') return { ok: false, problems: [`models.preferred: model ${model.id} runs task ${model.task}, not flf2v`] };
  const edit = [...library.extensionModels.values()].find((candidate) => candidate.task === 'i2i-edit');
  if (!edit) return { ok: false, problems: ['no edit model (task i2i-edit) to make the end frame'] };

  // The two jobs of a hook: the edit makes the end frame, the transition model animates the passage.
  const problems: string[] = [];
  const editTemplate = library.extensionTemplates.get(edit.workflow);
  const template = library.extensionTemplates.get(model.workflow);
  if (!editTemplate) problems.push(`model ${edit.id}: workflow ${edit.workflow} is not loaded`);
  else problems.push(...dryCompile(edit.id, () => compileHookEdit(preset, edit, editTemplate, { ...DRY_RUN, image2Ref: 'uploads/validate-2.png' }, library.lock)));
  if (!template) problems.push(`model ${model.id}: workflow ${model.workflow} is not loaded`);
  else problems.push(...dryCompile(model.id, () => compileHookTransition(preset, model, template, { ...DRY_RUN, endRef: 'uploads/validate-end.png', aspect: '16:9' })));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, preset };
}
