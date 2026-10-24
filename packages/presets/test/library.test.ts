import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, LibraryError } from '../src/index';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));

function toCrlf(dir: string) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) toCrlf(path);
    else writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
}

let crlfRoot = '';
beforeAll(() => {
  crlfRoot = join(mkdtempSync(join(tmpdir(), 'montagio-crlf-')), 'repo');
  cpSync(fixture('repo-ok'), crlfRoot, { recursive: true });
  toCrlf(crlfRoot);
});

test('loads the ok fixture repo', async () => {
  const lib = await loadLibrary(fixture('repo-ok'));
  expect([...lib.presets.keys()]).toEqual(['crash-push']);
  expect(lib.models.get('wan22-i2v-a14b-fun-camera')?.tier).toBe('quality');
  expect(lib.lock.size).toBe(4);
  expect(lib.templates.get('workflows/wan22-fun-camera.api.json')?.['12']?.class_type).toBe('WanCameraEmbedding');
});

test('a missing preview is only a warning', async () => {
  const lib = await loadLibrary(fixture('repo-ok'));
  expect(lib.warnings).toEqual([expect.stringMatching(/crash-push.*previews\/crash-push\.mp4/)]);
});

test('reports every problem at once', async () => {
  const error = await loadLibrary(fixture('repo-broken')).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LibraryError);
  expect((error as LibraryError).problems).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/crash-push.*unknown model.*wan-missing/),
      expect.stringMatching(/crash-push.*unknown model.*wan22-ti2v-5b/),
      expect.stringMatching(/wan22-i2v-a14b-fun-camera.*weights.*not-in-lock.*not in lock/),
    ]),
  );
});

test('CRLF files load', async () => {
  const lib = await loadLibrary(crlfRoot);
  expect(lib.presets.size).toBe(1);
  expect(lib.models.size).toBe(1);
});

test('the real repository library loads', async () => {
  const lib = await loadLibrary(repoRoot());
  expect([...lib.models.keys()].sort()).toEqual(['wan22-i2v-a14b-fun-camera', 'wan22-ti2v-5b', 'z-image-turbo']);
  expect(lib.presets.size).toBeGreaterThanOrEqual(3);
  expect(lib.extensions?.map((entry) => entry.id)).toEqual(['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion', 'restyle', 'swap']);
});

// Extension models (registry/extensions/) load apart from the preset models.

const EXTENSIONS_YAML = `schema: montagio/extensions@0.1
extensions:
  - { id: edit, priority: 1, gpu_validated: null }
  - { id: effects, priority: 2, gpu_validated: null }
  - { id: transitions, priority: 3, requires: [edit], gpu_validated: null }
  - { id: avatar, priority: 4, gpu_validated: null }
  - { id: music, priority: 5, gpu_validated: null }
  - { id: upscale, priority: 6, gpu_validated: null }
  - { id: motion, priority: 7, gpu_validated: null }
  - { id: restyle, priority: 8, gpu_validated: null }
  - { id: swap, priority: 9, requires: [restyle], gpu_validated: null }
`;

const extModel = (id: string, extension: string, weights: string[], workflow = 'workflows/ext-music.api.json') => `schema: montagio/extension-model@0.1
id: ${id}
name: ${id}
extension: ${extension}
task: t2a
license: MIT
weights: [${weights.join(', ')}]
workflow: ${workflow}
bindings:
  prompt: { node: "94", field: tags }
  duration_s: [{ node: "98", field: seconds }, { node: "94", field: duration }]
  seed: { node: "3", field: seed }
  bpm: { node: "94", field: bpm }
output: { node: "107", kind: audio }
estimate_s: 20
`;

const lockEntry = (id: string, file: string, extension?: string) =>
  `  - id: ${id}\n    file: ${file}\n    url: https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files\n    license: MIT\n    source: https://huggingface.co/ACE-Step/Ace-Step1.5\n${extension ? `    extension: ${extension}\n` : ''}`;

const MUSIC_WORKFLOW = JSON.stringify({ '106': { class_type: 'VAELoader', inputs: { vae_name: 'ace_1.5_vae.safetensors' } } });

/** A copy of repo-ok with `files` written over it (path relative to the repository root) and `lockExtra` appended to its lock. */
function repoWith(files: Record<string, string>, lockExtra = lockEntry('ace-step15-vae', 'ace_1.5_vae.safetensors', 'music')): string {
  const root = join(mkdtempSync(join(tmpdir(), 'montagio-ext-')), 'repo');
  cpSync(fixture('repo-ok'), root, { recursive: true });
  const lockPath = join(root, 'registry', 'models.lock.yaml');
  writeFileSync(lockPath, readFileSync(lockPath, 'utf8') + lockExtra);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const musicRepo = (extra: Record<string, string> = {}, lockExtra?: string) =>
  repoWith(
    {
      'registry/extensions.yaml': EXTENSIONS_YAML,
      'registry/extensions/ace-music.yaml': extModel('ace-music', 'music', ['ace-step15-vae']),
      'workflows/ext-music.api.json': MUSIC_WORKFLOW,
      ...extra,
    },
    lockExtra,
  );

const problemsOf = async (root: string) => {
  const error = await loadLibrary(root).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LibraryError);
  return (error as LibraryError).problems;
};

test('loads extension models apart from the preset models', async () => {
  const lib = await loadLibrary(musicRepo());
  expect([...lib.models.keys()]).toEqual(['wan22-i2v-a14b-fun-camera']);
  expect([...lib.extensionModels.keys()]).toEqual(['ace-music']);
  expect(lib.extensionTemplates.get('workflows/ext-music.api.json')?.['106']?.class_type).toBe('VAELoader');
  expect(lib.templates.has('workflows/ext-music.api.json')).toBe(false);
  expect(lib.extensions?.map((entry) => entry.id)).toEqual(['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion', 'restyle', 'swap']);
});

test('a repository without extensions loads as before', async () => {
  const lib = await loadLibrary(fixture('repo-ok'));
  expect(lib.extensions).toBeNull();
  expect(lib.extensionModels.size).toBe(0);
  expect(lib.extensionTemplates.size).toBe(0);
});

test('a duplicate extension model id is a problem', async () => {
  const root = musicRepo({ 'registry/extensions/ace-music-2.yaml': extModel('ace-music', 'music', ['ace-step15-vae']) });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/duplicate extension model id "ace-music"/));
});

test('an extension weight missing from the lock is a problem', async () => {
  const root = musicRepo({ 'registry/extensions/ace-music.yaml': extModel('ace-music', 'music', ['ace-step15-vae', 'ace-step15-ghost']) });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/extension model ace-music: weights "ace-step15-ghost" not in lock/));
});

test('a missing extension workflow is a problem', async () => {
  const root = musicRepo({ 'registry/extensions/ace-music.yaml': extModel('ace-music', 'music', ['ace-step15-vae'], 'workflows/ext-gone.api.json') });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/extension model ace-music: workflow workflows\/ext-gone\.api\.json not found/));
});

test('an extension workflow that is not valid JSON is a problem, not a crash', async () => {
  const root = musicRepo({ 'workflows/ext-music.api.json': MUSIC_WORKFLOW.slice(0, -1) });
  expect(await problemsOf(root)).toEqual([expect.stringMatching(/^extension model ace-music: workflow workflows\/ext-music\.api\.json is not valid JSON \(/)]);
});

test('extension models without registry/extensions.yaml are a problem', async () => {
  const root = repoWith({
    'registry/extensions/ace-music.yaml': extModel('ace-music', 'music', ['ace-step15-vae']),
    'workflows/ext-music.api.json': MUSIC_WORKFLOW,
  });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/registry\/extensions\.yaml.*missing/));
});

test('a lock entry of an extension that a preset model loads is a problem', async () => {
  // umt5 is a weight of the Fun Camera preset model: marking it as music would hide it from the installer
  const lock = readFileSync(join(fixture('repo-ok'), 'registry', 'models.lock.yaml'), 'utf8');
  const root = musicRepo();
  writeFileSync(
    join(root, 'registry', 'models.lock.yaml'),
    lock.replace('    source: https://huggingface.co/google/umt5-xxl\n', '    source: https://huggingface.co/google/umt5-xxl\n    extension: music\n') +
      lockEntry('ace-step15-vae', 'ace_1.5_vae.safetensors', 'music'),
  );
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/umt5-xxl-fp8 belongs to extension music but preset model wan22-i2v-a14b-fun-camera loads it/));
});

test('a lock entry of one extension that another extension loads is a problem', async () => {
  const root = musicRepo({ 'registry/extensions/ace-music.yaml': extModel('ace-music', 'upscale', ['ace-step15-vae']) });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/ace-step15-vae belongs to extension music but extension model ace-music \(upscale\) loads it/));
});

test('a weight only an extension loads must say so in the lock', async () => {
  const root = musicRepo({}, lockEntry('ace-step15-vae', 'ace_1.5_vae.safetensors'));
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/ace-step15-vae is loaded only by extension music: mark it "extension: music"/));
});

test("an extension may load a weight of the extension it requires, and only that one", async () => {
  const vace = lockEntry('ace-step15-vae', 'ace_1.5_vae.safetensors', 'music') + lockEntry('vace-w', 'vace.safetensors', 'restyle');
  const restyle = { 'registry/extensions/vace.yaml': extModel('vace', 'restyle', ['vace-w']) };
  const lib = await loadLibrary(musicRepo({ ...restyle, 'registry/extensions/swap.yaml': extModel('swap-m', 'swap', ['vace-w']) }, vace));
  expect(lib.extensionModels.get('swap-m')?.weights).toEqual(['vace-w']);
  const root = musicRepo({ ...restyle, 'registry/extensions/up.yaml': extModel('up', 'upscale', ['vace-w']) }, vace);
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/vace-w belongs to extension restyle but extension model up \(upscale\) loads it/));
});

test('a weight shared by two extensions is a problem', async () => {
  const root = musicRepo({ 'registry/extensions/seedvr.yaml': extModel('seedvr', 'upscale', ['ace-step15-vae']) });
  expect(await problemsOf(root)).toContainEqual(expect.stringMatching(/ace-step15-vae is shared by extensions music and upscale/));
});
