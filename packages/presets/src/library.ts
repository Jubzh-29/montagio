import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseExtensionModel,
  parseExtensionsConfig,
  parseLock,
  parseModel,
  type ExtensionId,
  type ExtensionModel,
  type ExtensionsConfig,
  type LockEntry,
  type ModelEntry,
} from '@montagio/registry';
import type { ApiWorkflow } from './compile';
import { parseEffectPreset, parsePreset, parseTransitionPreset } from './parse';
import type { EffectPreset, Preset, TransitionPreset } from './schema';

export type Library = {
  presets: Map<string, Preset>;
  /** Repository-relative file of each preset, e.g. "presets/crash-push.yaml". */
  presetFiles: Map<string, string>;
  models: Map<string, ModelEntry>;
  lock: Map<string, LockEntry>;
  /** Workflow templates keyed by the model's `workflow` path, e.g. "workflows/wan22-fun-camera.api.json". */
  templates: Map<string, ApiWorkflow>;
  /** Models of the extensions (registry/extensions/), kept apart from the preset models. */
  extensionModels: Map<string, ExtensionModel>;
  /** Workflow templates of the extension models, by `workflow` path. */
  extensionTemplates: Map<string, ApiWorkflow>;
  /** registry/extensions.yaml; null in a repository that has no extensions at all. */
  extensions: ExtensionsConfig | null;
  /** One-photo effects (presets/effects/), apart from the camera presets: the Studio does not list them. */
  effects: Map<string, EffectPreset>;
  /** Repository-relative file of each effect, e.g. "presets/effects/squish.yaml". */
  effectFiles: Map<string, string>;
  /** Keyframe transition hooks (presets/transitions/), apart from the camera presets too. */
  hooks: Map<string, TransitionPreset>;
  /** Repository-relative file of each hook, e.g. "presets/transitions/eyes-in.yaml". */
  hookFiles: Map<string, string>;
  warnings: string[];
};

export class LibraryError extends Error {
  override name = 'LibraryError';
  constructor(readonly problems: string[]) {
    super(`library has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  }
}

async function yamlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The `extension:` mark of the lock against who loads each weight. The installer
 * downloads a marked weight only for its extension, so a weight a preset model
 * needs must stay unmarked, and a weight only one extension needs must carry it.
 */
function lockExtensionProblems(
  lock: Map<string, LockEntry>,
  models: Map<string, ModelEntry>,
  extensionModels: Map<string, ExtensionModel>,
): string[] {
  const problems: string[] = [];
  const presetUsers = new Map<string, string[]>();
  for (const model of models.values()) {
    for (const weight of model.weights) presetUsers.set(weight, [...(presetUsers.get(weight) ?? []), model.id]);
  }
  const extensionUsers = new Map<string, { model: string; extension: ExtensionId }[]>();
  for (const model of extensionModels.values()) {
    for (const weight of model.weights) {
      extensionUsers.set(weight, [...(extensionUsers.get(weight) ?? []), { model: model.id, extension: model.extension }]);
    }
  }
  for (const entry of lock.values()) {
    const presets = presetUsers.get(entry.id) ?? [];
    const users = extensionUsers.get(entry.id) ?? [];
    if (entry.extension) {
      for (const preset of presets) {
        problems.push(`lock entry ${entry.id} belongs to extension ${entry.extension} but preset model ${preset} loads it`);
      }
      for (const user of users.filter((u) => u.extension !== entry.extension)) {
        problems.push(`lock entry ${entry.id} belongs to extension ${entry.extension} but extension model ${user.model} (${user.extension}) loads it`);
      }
    }
    if (presets.length > 0) continue;
    const kinds = [...new Set(users.map((user) => user.extension))];
    if (kinds.length > 1) problems.push(`lock entry ${entry.id} is shared by extensions ${kinds.join(' and ')}`);
    else if (kinds.length === 1 && !entry.extension) {
      problems.push(`lock entry ${entry.id} is loaded only by extension ${kinds[0]}: mark it "extension: ${kinds[0]}"`);
    }
  }
  return problems;
}

/**
 * Read and cross-check the repository library. `presets: false` skips
 * `presets/`, so a tool that checks preset files one by one (`montagio preset
 * validate`) still gets the models, the lock and the templates when one of
 * those files is broken.
 */
export async function loadLibrary(root: string, opts: { presets?: boolean } = {}): Promise<Library> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const presets = new Map<string, Preset>();
  const presetFiles = new Map<string, string>();
  const models = new Map<string, ModelEntry>();
  const lock = new Map<string, LockEntry>();
  const templates = new Map<string, ApiWorkflow>();
  const extensionModels = new Map<string, ExtensionModel>();
  const extensionTemplates = new Map<string, ApiWorkflow>();
  let extensions: ExtensionsConfig | null = null;
  const effects = new Map<string, EffectPreset>();
  const effectFiles = new Map<string, string>();
  const hooks = new Map<string, TransitionPreset>();
  const hookFiles = new Map<string, string>();

  const presetsDir = join(root, 'presets');
  for (const name of opts.presets === false ? [] : await yamlFiles(presetsDir)) {
    try {
      const preset = parsePreset(await readFile(join(presetsDir, name), 'utf8'), `presets/${name}`);
      if (presets.has(preset.id)) problems.push(`presets/${name}: duplicate preset id "${preset.id}"`);
      presets.set(preset.id, preset);
      presetFiles.set(preset.id, `presets/${name}`);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const effectsDir = join(presetsDir, 'effects');
  for (const name of opts.presets === false ? [] : await yamlFiles(effectsDir)) {
    try {
      const effect = parseEffectPreset(await readFile(join(effectsDir, name), 'utf8'), `presets/effects/${name}`);
      if (effects.has(effect.id)) problems.push(`presets/effects/${name}: duplicate effect id "${effect.id}"`);
      effects.set(effect.id, effect);
      effectFiles.set(effect.id, `presets/effects/${name}`);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const hooksDir = join(presetsDir, 'transitions');
  for (const name of opts.presets === false ? [] : await yamlFiles(hooksDir)) {
    try {
      const hook = parseTransitionPreset(await readFile(join(hooksDir, name), 'utf8'), `presets/transitions/${name}`);
      if (hooks.has(hook.id)) problems.push(`presets/transitions/${name}: duplicate hook id "${hook.id}"`);
      hooks.set(hook.id, hook);
      hookFiles.set(hook.id, `presets/transitions/${name}`);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const modelsDir = join(root, 'registry', 'models');
  for (const name of await yamlFiles(modelsDir)) {
    try {
      const model = parseModel(await readFile(join(modelsDir, name), 'utf8'), `registry/models/${name}`);
      if (models.has(model.id)) problems.push(`registry/models/${name}: duplicate model id "${model.id}"`);
      models.set(model.id, model);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const extensionsDir = join(root, 'registry', 'extensions');
  for (const name of await yamlFiles(extensionsDir)) {
    try {
      const model = parseExtensionModel(await readFile(join(extensionsDir, name), 'utf8'), `registry/extensions/${name}`);
      if (extensionModels.has(model.id)) problems.push(`registry/extensions/${name}: duplicate extension model id "${model.id}"`);
      extensionModels.set(model.id, model);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  try {
    extensions = parseExtensionsConfig(await readFile(join(root, 'registry', 'extensions.yaml'), 'utf8'), 'registry/extensions.yaml');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push((error as Error).message);
    else if (extensionModels.size > 0) problems.push('registry/extensions/ holds extension models but registry/extensions.yaml is missing');
  }

  const lockPath = join(root, 'registry', 'models.lock.yaml');
  try {
    for (const entry of parseLock(await readFile(lockPath, 'utf8'), 'registry/models.lock.yaml')) lock.set(entry.id, entry);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    problems.push(code === 'ENOENT' ? 'registry/models.lock.yaml: file not found' : (error as Error).message);
  }

  for (const preset of presets.values()) {
    const refs: [string, string | undefined][] = [
      ['models.preferred', preset.models.preferred],
      ['models.fallback', preset.models.fallback],
    ];
    for (const [field, id] of refs) {
      if (id && !models.has(id)) problems.push(`preset ${preset.id}: unknown model "${id}" (${field})`);
    }
    if (!(await exists(join(presetsDir, ...preset.preview.split('/'))))) {
      warnings.push(`preset ${preset.id}: preview ${preset.preview} not found yet`);
    }
  }

  for (const model of models.values()) {
    for (const weight of model.weights) {
      if (lock.size > 0 && !lock.has(weight)) problems.push(`model ${model.id}: weights "${weight}" not in lock`);
    }
    if (templates.has(model.workflow)) continue;
    try {
      const text = await readFile(join(root, ...model.workflow.split('/')), 'utf8');
      templates.set(model.workflow, JSON.parse(text) as ApiWorkflow);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      problems.push(
        code === 'ENOENT'
          ? `model ${model.id}: workflow ${model.workflow} not found`
          : `model ${model.id}: workflow ${model.workflow} is not valid JSON (${(error as Error).message})`,
      );
    }
  }

  for (const model of extensionModels.values()) {
    for (const weight of model.weights) {
      if (lock.size > 0 && !lock.has(weight)) problems.push(`extension model ${model.id}: weights "${weight}" not in lock`);
    }
    if (extensionTemplates.has(model.workflow)) continue;
    try {
      const text = await readFile(join(root, ...model.workflow.split('/')), 'utf8');
      extensionTemplates.set(model.workflow, JSON.parse(text) as ApiWorkflow);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      problems.push(
        code === 'ENOENT'
          ? `extension model ${model.id}: workflow ${model.workflow} not found`
          : `extension model ${model.id}: workflow ${model.workflow} is not valid JSON (${(error as Error).message})`,
      );
    }
  }
  problems.push(...lockExtensionProblems(lock, models, extensionModels));

  for (const effect of effects.values()) {
    const model = extensionModels.get(effect.models.preferred);
    if (!model) problems.push(`effect ${effect.id}: unknown effect model "${effect.models.preferred}"`);
    else if (model.task !== 'i2v-effect') problems.push(`effect ${effect.id}: model ${model.id} runs task ${model.task}, not i2v-effect`);
    else if (!model.weights.includes(effect.effect.lora)) problems.push(`effect ${effect.id}: LoRA "${effect.effect.lora}" is not a weight of model ${model.id}`);
    if (!(await exists(join(effectsDir, ...effect.preview.split('/'))))) {
      warnings.push(`effect ${effect.id}: preview ${effect.preview} not found yet`);
    }
  }

  const hasEditModel = [...extensionModels.values()].some((model) => model.task === 'i2i-edit');
  for (const hook of hooks.values()) {
    const model = extensionModels.get(hook.models.preferred);
    if (!model) problems.push(`hook ${hook.id}: unknown transition model "${hook.models.preferred}"`);
    else if (model.task !== 'flf2v') problems.push(`hook ${hook.id}: model ${model.id} runs task ${model.task}, not flf2v`);
    if (!hasEditModel) problems.push(`hook ${hook.id}: no edit model (task i2i-edit) to make its end frame`);
    if (!(await exists(join(hooksDir, ...hook.preview.split('/'))))) {
      warnings.push(`hook ${hook.id}: preview ${hook.preview} not found yet`);
    }
  }

  if (problems.length > 0) throw new LibraryError(problems);
  return { presets, presetFiles, models, lock, templates, extensionModels, extensionTemplates, extensions, effects, effectFiles, hooks, hookFiles, warnings };
}
