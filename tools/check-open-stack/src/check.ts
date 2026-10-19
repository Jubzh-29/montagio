import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryError, loadLibrary, type Library } from '@montagio/presets';
import { ALLOWED_WEIGHT_LICENSES, parseLock, type LockEntry } from '@montagio/registry';
import { parse as parseYaml } from 'yaml';

export type Violation = {
  rule: 'weight-license' | 'weight-source' | 'weight-file' | 'node-not-allowed' | 'forbidden-pattern' | 'closed-package' | 'library';
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
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|py)$/;
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'test-results',
  'playwright-report',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
]);

/** The web app's static export (the showcase build): bundled output, not source. Other folders named `out` are scanned. */
const WEB_EXPORT_DIR = join('apps', 'web', 'out');

async function readYaml<T>(path: string): Promise<T> {
  return parseYaml(await readFile(path, 'utf8')) as T;
}

/** The files under `dir`, without the build-output folders and the `skipped` paths. */
async function listFiles(dir: string, skipped: ReadonlySet<string> = new Set()): Promise<string[]> {
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
      if (!SKIPPED_DIRS.has(entry.name) && !skipped.has(path)) files.push(...(await listFiles(path, skipped)));
    } else {
      files.push(path);
    }
  }
  return files;
}

/** `from 'x'`, `import('x')` and `require('x')` specifiers. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

type ClosedList = { name: string; reason: string }[];

/**
 * Looks a package up in a forbidden-package list and returns the reason it is closed.
 * "scope/*" matches every package of an npm scope. `normalize` is applied to both the
 * list's names and the queried name (npm names are compared as written).
 */
function closedMatcher(packages: ClosedList, normalize: (name: string) => string = (name) => name) {
  const closed = packages.map(({ name, reason }) => ({ name: normalize(name), reason }));
  return (pkg: string): string | undefined => {
    const wanted = normalize(pkg);
    return closed.find(({ name }) => (name.endsWith('/*') ? wanted.startsWith(name.slice(0, -1)) : wanted === name))?.reason;
  };
}

/** PEP 503 name normalization: lowercase, runs of "-", "_" and "." folded to "-". */
const normalizePypiName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');

/**
 * The distributions a requirements.txt asks for, PEP 503 normalized. Comments, blank
 * lines and option lines (-r, -e, --index-url, ...) are skipped; versions, extras,
 * markers and URLs after the name are dropped.
 */
function requirementNames(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const name = /^[A-Za-z0-9][A-Za-z0-9._-]*(?=$|[\s[;=<>!~@(,])/.exec(line)?.[0];
    if (name) names.push(normalizePypiName(name));
  }
  return names;
}

type TomlToken = { kind: 'string' | 'word' | 'punct' | 'eol'; text: string };

/**
 * Just enough TOML lexing to find an array of strings: comments dropped, basic, literal
 * and triple-quoted strings decoded (escapes loosely: the next character is kept),
 * bare keys as words, and `[ ] = , { }` as punctuation.
 */
function tomlTokens(text: string): TomlToken[] {
  const tokens: TomlToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '\n') {
      tokens.push({ kind: 'eol', text: '' });
      i++;
    } else if (ch === '"' || ch === "'") {
      const quote = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      let value = '';
      i += quote.length;
      while (i < text.length && !text.startsWith(quote, i) && !(quote.length === 1 && text[i] === '\n')) {
        if (ch === '"' && text[i] === '\\') i++;
        value += text[i] ?? '';
        i++;
      }
      if (text.startsWith(quote, i)) i += quote.length;
      tokens.push({ kind: 'string', text: value });
    } else if (/[\w.-]/.test(ch)) {
      const start = i;
      while (i < text.length && /[\w.-]/.test(text[i]!)) i++;
      tokens.push({ kind: 'word', text: text.slice(start, i) });
    } else {
      if ('[]=,{}'.includes(ch)) tokens.push({ kind: 'punct', text: ch });
      i++;
    }
  }
  return tokens;
}

/**
 * The strings of `dependencies = [ ... ]` under `[project]` in a pyproject.toml, which is
 * what the Comfy Registry publishes. A `dependencies` key of any other table is not read.
 */
function pyprojectDependencies(text: string): string[] {
  const tokens = tomlTokens(text);
  const found: string[] = [];
  let table = '';
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    if (token.kind === 'punct' && token.text === '[') {
      // `[table]` or `[[array.of.tables]]`: the rest of the line names the table
      const parts: string[] = [];
      for (i++; i < tokens.length && tokens[i]!.kind !== 'eol'; i++) {
        if (tokens[i]!.kind === 'word' || tokens[i]!.kind === 'string') parts.push(tokens[i]!.text);
      }
      table = parts.join('');
    } else if ((token.kind === 'word' || token.kind === 'string') && next?.kind === 'punct' && next.text === '=') {
      const wanted = (table ? `${table}.${token.text}` : token.text) === 'project.dependencies';
      let depth = 0;
      for (i += 2; i < tokens.length; i++) {
        const value = tokens[i]!;
        if (value.kind === 'punct') depth += '[{'.includes(value.text) ? 1 : ']}'.includes(value.text) ? -1 : 0;
        else if (value.kind === 'eol' && depth <= 0) break;
        else if (value.kind === 'string' && wanted) found.push(value.text);
      }
    } else {
      i++;
    }
  }
  return found;
}

/** Python dependency files of the ComfyUI pack (relative to comfy-nodes/) and how each one lists its requirements. */
const PYTHON_MANIFESTS: { file: string; names: (text: string) => string[] }[] = [
  { file: 'requirements.txt', names: requirementNames },
  { file: 'requirements-dev.txt', names: requirementNames },
  { file: 'pyproject.toml', names: (text) => requirementNames(pyprojectDependencies(text).join('\n')) },
];

/**
 * `import a.b, c as d` and `from a import b, c as d` statements at the start of a line.
 * The anchor keeps prose, strings and comments out; the price is that a docstring line
 * that itself begins with "import openai" is read as an import (accepted false positive).
 */
const PYTHON_IMPORT = /^[ \t]*import[ \t]+([^\n#;]+)/gm;
const PYTHON_FROM_IMPORT = /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]*(\([^)]*\)|[^\n]*)/gm;

/**
 * Modules a Python source imports, in source order. `from a import b` yields `a` and `a.b`,
 * since b may be a submodule (`from google import genai`). Relative imports are local code.
 */
function pythonImports(text: string): string[] {
  const found: { index: number; modules: string[] }[] = [];
  const names = (list: string): string[] =>
    list
      .replace(/#[^\n]*/g, '')
      .replace(/[()]/g, '')
      .split(',')
      .map((item) => item.trim().split(/\s+/)[0] ?? '')
      .filter((name) => /^[A-Za-z_][\w.]*$/.test(name));
  for (const match of text.matchAll(PYTHON_IMPORT)) {
    found.push({ index: match.index, modules: names(match[1] ?? '') });
  }
  for (const match of text.matchAll(PYTHON_FROM_IMPORT)) {
    const module = match[1] ?? '';
    if (module.startsWith('.')) continue;
    found.push({ index: match.index, modules: [module, ...names(match[2] ?? '').map((name) => `${module}.${name}`)] });
  }
  return found.sort((a, b) => a.index - b.index).flatMap(({ modules }) => modules);
}

/** A file's text, or "" when it does not exist; any other read error is real. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** The repository's package.json files: root, apps/*, packages/*, tools/*, infra/*. */
async function packageManifests(root: string): Promise<string[]> {
  const manifests = [join(root, 'package.json')];
  for (const group of ['apps', 'packages', 'tools', 'infra']) {
    try {
      for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
        if (entry.isDirectory()) manifests.push(join(root, group, entry.name, 'package.json'));
      }
    } catch {
      // group absent
    }
  }
  const present: string[] = [];
  for (const manifest of manifests) {
    try {
      await readFile(manifest);
      present.push(manifest);
    } catch {
      // no manifest in this folder
    }
  }
  return present;
}

/**
 * Directories whose source code must stay free of closed APIs. Infra scripts
 * (GPU session tooling) sit at the root of their folder, so infra/ is scanned whole;
 * so is comfy-nodes/, the ComfyUI node pack (Python, plus its TypeScript test bridge).
 */
async function sourceDirs(root: string): Promise<string[]> {
  const dirs = [join(root, 'apps'), join(root, 'infra'), join(root, 'comfy-nodes')];
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

/** allowed-sources.yaml: the Hugging Face repositories a lock weight may come from, and those it never may. */
type AllowedSources = {
  sources: { repo: string; license: string; role: 'source' | 'mirror'; revision: string; license_file: boolean; note?: string }[];
  denied: { repo: string; reason: string }[];
};

/** "<owner>/<repo>" of a Hugging Face URL, whether it names the repository or a file in it. */
function hfRepo(url: string): string | null {
  return /^https:\/\/huggingface\.co\/([^/]+\/[^/?#]+)/.exec(url)?.[1] ?? null;
}

/** A refused repository; its `repo` may hold `*`, which stands for any run of characters but `/`. */
function deniedEntry(sources: AllowedSources, repo: string) {
  return sources.denied.find(({ repo: pattern }) => {
    const parts = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^${parts.join('[^/]*')}$`).test(repo);
  });
}

/**
 * A lock entry is fetched from its url and licensed by its source: the url's repository must be
 * listed (a mirror or a source) and not refused, the source must be listed as a source, and the
 * lock's license must be the source's (a mirror never changes it).
 */
function weightSourceProblems(lock: LockEntry[], sources: AllowedSources): string[] {
  const problems: string[] = [];
  const listed = new Map(sources.sources.map((source) => [source.repo, source]));
  const unknown = 'an unknown source repo (list it in allowed-sources.yaml with the license read at the source)';
  for (const entry of lock) {
    const fetched = hfRepo(entry.url);
    const denied = fetched ? deniedEntry(sources, fetched) : undefined;
    if (denied) problems.push(`${entry.id} is fetched from ${fetched}, a refused repository: ${denied.reason}`);
    else if (!fetched || !listed.has(fetched)) problems.push(`${entry.id} is fetched from ${fetched ?? entry.url}, ${unknown}`);

    const named = hfRepo(entry.source);
    const source = named ? listed.get(named) : undefined;
    const deniedSource = named ? deniedEntry(sources, named) : undefined;
    if (deniedSource) problems.push(`${entry.id} names ${named} as its source, a refused repository: ${deniedSource.reason}`);
    else if (!source) problems.push(`${entry.id} names ${named ?? entry.source} as its source, ${unknown}`);
    else if (source.role !== 'source') problems.push(`${entry.id} names the mirror ${named} as its source; name the repository the weights were published in`);
    else if (source.license !== entry.license) problems.push(`${entry.id}: license ${entry.license} differs from its source ${named} (${source.license})`);
  }
  return problems;
}

/**
 * `configDir` holds allowed-nodes.yaml, allowed-sources.yaml and forbidden-patterns.yaml; it defaults to
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

  // Weight sources: the repository each file is fetched from, and the one its license is read from.
  const sources = await readYaml<AllowedSources>(join(configDir, 'allowed-sources.yaml'));
  for (const detail of weightSourceProblems(lock, sources)) violations.push({ rule: 'weight-source', file: lockFile, detail });

  // Weight files actually loaded: every file a workflow node or a preset LoRA
  // names must be a lock entry (whose license was checked above) and, for a
  // model's workflow, one of that model's declared weights.
  const lockFiles = new Map(lock.map((entry) => [entry.file, entry]));
  const allowedFilesFor = (workflowPath: string): { files: Set<string>; owner: string } => {
    const owners = library
      ? [...library.models.values(), ...library.extensionModels.values()].filter((model) => model.workflow === workflowPath)
      : [];
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

  // Closed-API SDKs: never declared as a dependency, never imported.
  const closedPackages = await readYaml<{ packages: ClosedList }>(join(configDir, 'forbidden-packages.yaml'));
  const closedReason = closedMatcher(closedPackages.packages);
  for (const manifest of await packageManifests(root)) {
    const json = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const pkg of Object.keys(json[field] ?? {})) {
        const reason = closedReason(pkg);
        if (reason) {
          violations.push({ rule: 'closed-package', file: relative(root, manifest), detail: `${field} declares "${pkg}" (${reason})` });
        }
      }
    }
  }

  // The ComfyUI node pack declares its Python dependencies in requirements.txt,
  // requirements-dev.txt and pyproject.toml (the [project].dependencies the Comfy Registry
  // publishes), checked against the PyPI list (names collide with npm ones, so the lists
  // stay apart).
  const closedPythonPackages = await readYaml<{ packages: (ClosedList[number] & { imports?: string[] })[] }>(
    join(configDir, 'forbidden-python-packages.yaml'),
  );
  const closedPythonReason = closedMatcher(closedPythonPackages.packages, normalizePypiName);
  for (const { file, names } of PYTHON_MANIFESTS) {
    const manifest = join('comfy-nodes', file);
    for (const name of names(await readIfPresent(join(root, manifest)))) {
      const reason = closedPythonReason(name);
      if (reason) violations.push({ rule: 'closed-package', file: manifest, detail: `requires "${name}" (${reason})` });
    }
  }
  // Python modules that belong to those packages, as listed by `imports` (default: the name).
  const closedPythonModules = closedPythonPackages.packages.flatMap(({ name, imports, reason }) =>
    (imports ?? [name]).map((module) => ({ module, reason })),
  );

  // Source code: no closed API host, no Comfy Router, no closed-API SDK import.
  const forbidden = await readYaml<{ patterns: { pattern: string; reason: string }[] }>(
    join(configDir, 'forbidden-patterns.yaml'),
  );
  const patterns = forbidden.patterns.map(({ pattern, reason }) => ({ regex: new RegExp(pattern), reason }));
  const notSource = new Set([join(root, WEB_EXPORT_DIR)]);
  for (const dir of await sourceDirs(root)) {
    for (const path of await listFiles(dir, notSource)) {
      if (!SOURCE_EXTENSIONS.test(path)) continue;
      const text = await readFile(path, 'utf8');
      for (const { regex, reason } of patterns) {
        if (regex.test(text)) {
          violations.push({ rule: 'forbidden-pattern', file: relative(root, path), detail: `${reason} (/${regex.source}/)` });
        }
      }
      // JS import syntax means nothing in Python, and the npm list does not apply to it:
      // Python files get their own import check, against the PyPI list's modules.
      if (path.endsWith('.py')) {
        const reported = new Set<string>();
        for (const imported of pythonImports(text)) {
          const closed = closedPythonModules.find(({ module }) => imported === module || imported.startsWith(`${module}.`));
          if (closed && !reported.has(closed.module)) {
            reported.add(closed.module);
            violations.push({ rule: 'closed-package', file: relative(root, path), detail: `imports "${closed.module}" (${closed.reason})` });
          }
        }
        continue;
      }
      for (const match of text.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1] ?? '';
        const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
        const reason = closedReason(pkg);
        if (reason) {
          violations.push({ rule: 'closed-package', file: relative(root, path), detail: `imports "${pkg}" (${reason})` });
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
