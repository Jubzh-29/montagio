import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '@montagio/presets';
import { enabledExtensions, parseExtensionsConfig as registryExtensions, parseLock } from '@montagio/registry';
import { folderFor, parseHfUrl, weightFolders } from '../../runpod/lib/weights';
import {
  parseExtensionsConfig,
  parseLockWeights,
  parseVersionsEnv,
  readExtensions,
  readLock,
  readVersions,
  installDefaultExtensions,
  selectExtensions,
  weightsFor,
  type LockWeight,
} from '../src/pins.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('parseVersionsEnv reads KEY=VALUE lines and skips comments and blank lines', () => {
  expect(parseVersionsEnv('# a comment\n\nA=1\n  # indented comment\nB=two words\nC=x=y\n')).toEqual({ A: '1', B: 'two words', C: 'x=y' });
});

test('readVersions takes every pin from infra/runpod/versions.env', () => {
  const versions = readVersions(repoRoot);
  expect(versions.comfyuiTag).toBe('v0.41.0');
  expect(versions.comfyuiCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(versions.comfyuiRepo).toBe('https://github.com/Comfy-Org/ComfyUI.git');
  expect(versions.proxyVersion).toBe('0.1.6');
  expect(versions.torch).toEqual({ torch: '2.14.1', torchvision: '0.29.1', cuda: 'cu130', minDriverCuda: [13, 0] });
  expect(versions.torchFallback).toEqual({ torch: '2.11.0', torchvision: '0.26.0', cuda: 'cu128', minDriverCuda: [12, 8] });
});

test('a missing pin is named in the error', async () => {
  const { versionsFrom } = await import('../src/pins.ts');
  expect(() => versionsFrom({ COMFYUI_REPO: 'r', COMFYUI_TAG: 't' })).toThrow(/COMFYUI_COMMIT/);
});

test('readLock gives the same files, URLs, sha256, sizes and extensions as the registry parser', () => {
  const text = readFileSync(join(repoRoot, 'registry', 'models.lock.yaml'), 'utf8');
  const official = parseLock(text, 'models.lock.yaml');
  const ours = readLock(repoRoot);
  expect(ours.map(({ folder: _folder, ...rest }) => rest)).toEqual(
    official.map(({ id, file, url, sha256, size, extension }) => ({ id, file, url, sha256, size, extension: extension ?? null })),
  );
  expect(ours.length).toBeGreaterThanOrEqual(9);
});

test('the ComfyUI folder of each weight is the one fetch-weights writes it to', async () => {
  const library = await loadLibrary(repoRoot);
  const folders = weightFolders([...library.templates.values(), ...library.extensionTemplates.values()]);
  for (const weight of readLock(repoRoot)) {
    const entry = library.lock.get(weight.id)!;
    expect(weight.folder, weight.id).toBe(folderFor(weight.file, parseHfUrl(weight.url).path!, folders, entry.folder));
  }
  // loading the whole library takes more than the default 5 s on a loaded laptop
}, 30_000);

test('parseExtensionsConfig reads registry/extensions.yaml as @montagio/registry does', () => {
  const text = readFileSync(join(repoRoot, 'registry', 'extensions.yaml'), 'utf8');
  expect(parseExtensionsConfig(text)).toEqual(
    registryExtensions(text, 'extensions.yaml').map(({ id, priority, requires, gpu_validated, low_vram_validated }) => ({
      id,
      priority,
      requires,
      gpuValidated: gpu_validated,
      lowVramValidated: low_vram_validated,
    })),
  );
  expect(readExtensions(repoRoot).map((e) => e.id)).toEqual(['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion']);
});

describe('requires: an inline list, as registry/extensions.yaml keeps it', () => {
  const config = (requires: string) =>
    ['schema: montagio/extensions@0.1', 'extensions:', '  - id: edit', '    priority: 1', '  - id: transitions', '    priority: 3', requires, '    gpu_validated: null', ''].join('\n');

  test.each([
    ['    requires: []', []],
    ['    requires: [edit]', ['edit']],
    ['    requires: [ edit, music ]  # both', ['edit', 'music']],
  ])('%s', (requires, ids) => {
    expect(parseExtensionsConfig(config(requires))[1]?.requires).toEqual(ids);
  });

  test.each([
    ['a block list, which the flat reader would read as none', '    requires:\n      - edit'],
    ['a bare id, which the registry refuses', '    requires: edit'],
  ])('%s is refused', (_case, requires) => {
    expect(() => parseExtensionsConfig(config(requires))).toThrow(/extension transitions: requires must be an inline list/);
  });
});

test('a repository without registry/extensions.yaml has no extensions', () => {
  expect(readExtensions(join(repoRoot, 'infra'))).toEqual([]);
});

describe('selectExtensions agrees with enabledExtensions', () => {
  const text = [
    'schema: montagio/extensions@0.1',
    'extensions:',
    '  - id: edit',
    '    priority: 1',
    '    gpu_validated: 2026-10-22',
    '  - id: effects',
    '    priority: 2',
    '    gpu_validated: null',
    '  - id: transitions',
    '    priority: 3',
    '    requires: [edit]',
    '    gpu_validated: 2026-10-22',
    '  - id: avatar',
    '    priority: 4',
    '    gpu_validated: null',
    '  - id: music',
    '    priority: 5',
    '    gpu_validated: 2026-10-22',
    '  - id: upscale',
    '    priority: 6',
    '    gpu_validated: null',
    '  - id: motion',
    '    priority: 7',
    '    gpu_validated: null',
    '',
  ].join('\n');
  const editNotValidated = text.replace('priority: 1\n    gpu_validated: 2026-10-22', 'priority: 1\n    gpu_validated: null');
  test.each([undefined, '', 'validated', 'all', 'none', 'edit, music', 'transitions,edit'])('flag %j', (flag) => {
    expect(selectExtensions(parseExtensionsConfig(text), flag)).toEqual(enabledExtensions(registryExtensions(text, 'e.yaml'), flag));
  });
  test('a validated extension whose requirement is not validated is left out by both', () => {
    expect(selectExtensions(parseExtensionsConfig(editNotValidated), 'validated')).toEqual(['music']);
    expect(enabledExtensions(registryExtensions(editNotValidated, 'e.yaml'), 'validated')).toEqual(['music']);
  });
  test('a list without a requirement is refused by both, saying what to add', () => {
    expect(() => enabledExtensions(registryExtensions(text, 'e.yaml'), 'transitions')).toThrow(/transitions requires edit/);
    expect(() => selectExtensions(parseExtensionsConfig(text), 'transitions')).toThrow(/transitions requires edit/);
  });
  test('an unknown extension is refused by both', () => {
    expect(() => enabledExtensions(registryExtensions(text, 'e.yaml'), 'music,karaoke')).toThrow(/karaoke/);
    expect(() => selectExtensions(parseExtensionsConfig(text), 'music,karaoke')).toThrow(/karaoke/);
  });
});

describe('installDefaultExtensions: a plain install takes the effects pack, once a GPU session validated it', () => {
  const config = (effects: string, music: string) =>
    parseExtensionsConfig(
      [
        'schema: montagio/extensions@0.1',
        'extensions:',
        '  - id: edit',
        '    priority: 1',
        '    gpu_validated: 2026-10-21',
        '  - id: effects',
        '    priority: 2',
        `    gpu_validated: ${effects}`,
        '  - id: music',
        '    priority: 5',
        `    gpu_validated: ${music}`,
        '',
      ].join('\n'),
    );
  test('the effects pack alone, even when other extensions are validated too', () => {
    expect(installDefaultExtensions(config('2026-10-21', '2026-10-21'))).toEqual(['effects']);
  });
  test('nothing while the effects pack is not validated, whatever else is', () => {
    expect(installDefaultExtensions(config('null', '2026-10-21'))).toEqual([]);
  });
  test("the repository's registry: the effects pack (session S2 validated the seven)", () => {
    expect(installDefaultExtensions(readExtensions(repoRoot))).toEqual(['effects']);
  });
});

test('weightsFor keeps the core weights and those of the extensions asked for', () => {
  const lock = [
    { id: 'core', extension: null },
    { id: 'music-vae', extension: 'music' },
    { id: 'edit-te', extension: 'edit' },
  ] as LockWeight[];
  expect(weightsFor(lock, []).map((w) => w.id)).toEqual(['core']);
  expect(weightsFor(lock, ['music']).map((w) => w.id)).toEqual(['core', 'music-vae']);
});

const entry = (lines: string[]) => `schema: montagio/lock@0.1\nweights:\n${lines.map((l) => `    ${l}`).join('\n').replace(/^ {4}id/, '  - id')}\n`;
const URL_VAE = 'https://huggingface.co/Comfy-Org/x/resolve/main/split_files/vae/a.safetensors';

test('a lock entry without sha256 or size is refused', () => {
  expect(() => parseLockWeights(entry(['id: a', 'file: a.safetensors', `url: ${URL_VAE}`, 'size: 3', 'license: MIT']))).toThrow(
    'lock entry a has no sha256',
  );
  expect(() => parseLockWeights(entry(['id: a', 'file: a.safetensors', `url: ${URL_VAE}`, `sha256: ${'a'.repeat(64)}`, 'license: MIT']))).toThrow(
    'lock entry a has no size',
  );
});

test('a lock entry whose URL names no ComfyUI folder is refused', () => {
  const url = 'https://huggingface.co/Comfy-Org/x/resolve/main/weights/a.safetensors';
  expect(() => parseLockWeights(entry(['id: a', 'file: a.safetensors', `url: ${url}`, `sha256: ${'a'.repeat(64)}`, 'size: 3', 'license: MIT']))).toThrow(
    /lock entry a.*ComfyUI folder/,
  );
});

test('parseLockWeights reads an entry and ignores the keys it does not need', () => {
  const sha = 'b'.repeat(64);
  expect(
    parseLockWeights(entry(['id: a', 'file: a.safetensors', `url: ${URL_VAE}`, `sha256: ${sha}`, 'size: 12', 'license: MIT', 'source: https://x'])),
  ).toEqual([{ id: 'a', file: 'a.safetensors', url: URL_VAE, sha256: sha, size: 12, folder: 'vae', extension: null }]);
});

test('a lock entry may carry an extension', () => {
  const sha = 'c'.repeat(64);
  const base = ['id: a', 'file: a.safetensors', `url: ${URL_VAE}`, `sha256: ${sha}`, 'size: 12', 'license: MIT'];
  expect(parseLockWeights(entry([...base, 'extension: music']))[0]?.extension).toBe('music');
  expect(parseLockWeights(entry(base))[0]?.extension).toBeNull();
});

test('audio_encoders is a ComfyUI folder', () => {
  const url = 'https://huggingface.co/Comfy-Org/x/resolve/main/split_files/audio_encoders/w.safetensors';
  expect(parseLockWeights(entry(['id: a', 'file: w.safetensors', `url: ${url}`, `sha256: ${'d'.repeat(64)}`, 'size: 3']))[0]?.folder).toBe('audio_encoders');
});

test('frame_interpolation is a ComfyUI folder (RIFE of the HD pass)', () => {
  const url = 'https://huggingface.co/Comfy-Org/Frame-Interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors';
  expect(parseLockWeights(entry(['id: a', 'file: rife_v4.26.safetensors', `url: ${url}`, `sha256: ${'e'.repeat(64)}`, 'size: 3']))[0]?.folder).toBe('frame_interpolation');
});

test('an explicit nested folder wins over the URL', () => {
  const url = 'https://huggingface.co/ResembleAI/chatterbox/resolve/main/t3_mtl23ls_v3.safetensors';
  const lines = ['id: a', 'file: t3_mtl23ls_v3.safetensors', `url: ${url}`, `sha256: ${'e'.repeat(64)}`, 'size: 3', 'folder: tts/chatterbox/resembleai-mtl-v3'];
  expect(parseLockWeights(entry(lines))[0]?.folder).toBe('tts/chatterbox/resembleai-mtl-v3');
});

test.each(['weights/x', 'tts/../vae', '/abs', 'tts/chatterbox\\..\\..\\evil', 'tts\\chatterbox','tts/a b', 'tts/c:d'])('the folder %s is refused', (folder) => {
  const lines = ['id: a', 'file: a.safetensors', `url: ${URL_VAE}`, `sha256: ${'f'.repeat(64)}`, 'size: 3', `folder: ${folder}`];
  expect(() => parseLockWeights(entry(lines))).toThrow(/lock entry a.*folder/);
});
