import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLock, parseModel, type LockEntry, type ModelEntry } from '@montagio/registry';
import type { ApiWorkflow } from './compile';
import { parsePreset } from './parse';
import type { Preset } from './schema';

export type Library = {
  presets: Map<string, Preset>;
  /** Repository-relative file of each preset, e.g. "presets/crash-push.yaml". */
  presetFiles: Map<string, string>;
  models: Map<string, ModelEntry>;
  lock: Map<string, LockEntry>;
  /** Workflow templates keyed by the model's `workflow` path, e.g. "workflows/wan22-fun-camera.api.json". */
  templates: Map<string, ApiWorkflow>;
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

  if (problems.length > 0) throw new LibraryError(problems);
  return { presets, presetFiles, models, lock, templates, warnings };
}
