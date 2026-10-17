import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryError, loadLibrary, type Library } from '@montagio/presets';
import { ALLOWED_WEIGHT_LICENSES, parseLock, type LockEntry } from '@montagio/registry';
import { parse as parseYaml } from 'yaml';

export type Violation = {
  rule: 'weight-license' | 'weight-file' | 'node-not-allowed' | 'forbidden-pattern' | 'library';
  file: string;
  detail: string;
};

export type OpenStackReport = {
  ok: boolean;
  checkedAt: string;
  models: { id: string; license: string; weights: { id: string; license: string }[] }[];
  violations: Violation[];
};

/** Input values that name a model weight file. */
const WEIGHT_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'test-results', 'playwright-report']);

async function readYaml<T>(path: string): Promise<T> {
  return parseYaml(await readFile(path, 'utf8')) as T;
}

async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

/** Directories whose source code must stay free of closed APIs. */
async function sourceDirs(root: string): Promise<string[]> {
  const dirs = [join(root, 'apps')];
  for (const group of ['packages', 'tools']) {
    try {
      for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(join(root, group, entry.name, 'src'));
      }
    } catch {
      // group absent: nothing to scan
    }
  }
  return dirs;
}

/**
 * `configDir` holds allowed-nodes.yaml and forbidden-patterns.yaml; it defaults to
 * this package directory and must be passed explicitly when the code is bundled.
 */
export async function checkOpenStack(root: string, opts: { configDir?: string } = {}): Promise<OpenStackReport> {
  const configDir = opts.configDir ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const violations: Violation[] = [];
  const allowedLicenses: readonly string[] = ALLOWED_WEIGHT_LICENSES;

  let library: Library | null = null;
  try {
    library = await loadLibrary(root);
  } catch (error) {
    if (!(error instanceof LibraryError)) throw error;
    for (const problem of error.problems) violations.push({ rule: 'library', file: '(library)', detail: problem });
  }

  // Weight licenses: every lock entry must be usable by anyone, anywhere.
  const lockFile = join('registry', 'models.lock.yaml');
  let lock: LockEntry[] = library ? [...library.lock.values()] : [];
  if (!library) {
    try {
      lock = parseLock(await readFile(join(root, lockFile), 'utf8'), lockFile);
    } catch {
      lock = [];
    }
  }
  for (const entry of lock) {
    if (!allowedLicenses.includes(entry.license)) {
      violations.push({
        rule: 'weight-license',
        file: lockFile,
        detail: `${entry.id} is licensed "${entry.license}" (allowed: ${allowedLicenses.join(', ')})`,
      });
    }
  }

  // Weight files actually loaded: every file a workflow node or a preset LoRA
  // names must be a lock entry (whose license was checked above) and, for a
  // model's workflow, one of that model's declared weights.
  const lockFiles = new Map(lock.map((entry) => [entry.file, entry]));
  const allowedFilesFor = (workflowPath: string): { files: Set<string>; owner: string } => {
    const owners = library ? [...library.models.values()].filter((model) => model.workflow === workflowPath) : [];
    if (owners.length === 0) return { files: new Set(lockFiles.keys()), owner: 'any lock entry' };
    const ids = new Set(owners.flatMap((model) => model.weights));
    return {
      files: new Set(lock.filter((entry) => ids.has(entry.id)).map((entry) => entry.file)),
      owner: `the declared weights of ${owners.map((model) => model.id).join(', ')}`,
    };
  };
  for (const [presetId, preset] of library?.presets ?? []) {
    for (const lora of preset.loras) {
      if (!lockFiles.has(lora.file)) {
        violations.push({
          rule: 'weight-file',
          file: library?.presetFiles.get(presetId) ?? `presets/${presetId}.yaml`,
          detail: `LoRA "${lora.file}" is not in registry/models.lock.yaml`,
        });
      }
    }
  }

  // Workflow nodes: allow-list only, so partner nodes and unknown nodes are refused.
  const allowed = await readYaml<{ nodes: { class_type: string }[] }>(join(configDir, 'allowed-nodes.yaml'));
  const allowedNodes = new Set(allowed.nodes.map((node) => node.class_type));
  for (const path of await listFiles(join(root, 'workflows'))) {
    if (!path.endsWith('.json')) continue;
    const workflow = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      { class_type?: string; inputs?: Record<string, unknown> }
    >;
    const workflowPath = relative(root, path).split(sep).join('/');
    const { files, owner } = allowedFilesFor(workflowPath);
    for (const [id, node] of Object.entries(workflow)) {
      if (!node.class_type || !allowedNodes.has(node.class_type)) {
        violations.push({
          rule: 'node-not-allowed',
          file: relative(root, path),
          detail: `node ${id} uses "${node.class_type ?? '(none)'}", which is not in allowed-nodes.yaml`,
        });
      }
      for (const value of Object.values(node.inputs ?? {})) {
        if (typeof value === 'string' && WEIGHT_FILE.test(value) && !files.has(value)) {
          violations.push({
            rule: 'weight-file',
            file: relative(root, path),
            detail: `node ${id} loads "${value}", which is not one of ${owner}`,
          });
        }
      }
    }
  }

  // Source code: no closed API host, no Comfy Router.
  const forbidden = await readYaml<{ patterns: { pattern: string; reason: string }[] }>(
    join(configDir, 'forbidden-patterns.yaml'),
  );
  const patterns = forbidden.patterns.map(({ pattern, reason }) => ({ regex: new RegExp(pattern), reason }));
  for (const dir of await sourceDirs(root)) {
    for (const path of await listFiles(dir)) {
      if (!SOURCE_EXTENSIONS.test(path)) continue;
      const text = await readFile(path, 'utf8');
      for (const { regex, reason } of patterns) {
        if (regex.test(text)) {
          violations.push({ rule: 'forbidden-pattern', file: relative(root, path), detail: `${reason} (/${regex.source}/)` });
        }
      }
    }
  }

  const lockById = new Map(lock.map((entry) => [entry.id, entry]));
  const models = library
    ? [...library.models.values()].map((model) => ({
        id: model.id,
        license: model.license,
        weights: model.weights.map((id) => ({ id, license: lockById.get(id)?.license ?? '(missing)' })),
      }))
    : [];

  return { ok: violations.length === 0, checkedAt: new Date().toISOString(), models, violations };
}
