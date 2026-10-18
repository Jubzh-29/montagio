import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '@montagio/presets';
import { parseLock } from '@montagio/registry';
import { folderFor, parseHfUrl, weightFolders } from '../../runpod/lib/weights';
import { parseLockWeights, parseVersionsEnv, readLock, readVersions } from '../src/pins.ts';

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

test('readLock gives the same files, URLs, sha256 and sizes as the registry parser', () => {
  const text = readFileSync(join(repoRoot, 'registry', 'models.lock.yaml'), 'utf8');
  const official = parseLock(text, 'models.lock.yaml');
  const ours = readLock(repoRoot);
  expect(ours.map(({ folder: _folder, ...rest }) => rest)).toEqual(
    official.map(({ id, file, url, sha256, size }) => ({ id, file, url, sha256, size })),
  );
  expect(ours).toHaveLength(9);
});

test('the ComfyUI folder of each weight is the one fetch-weights writes it to', async () => {
  const library = await loadLibrary(repoRoot);
  const folders = weightFolders([...library.templates.values()]);
  for (const weight of readLock(repoRoot)) {
    expect(weight.folder, weight.id).toBe(folderFor(weight.file, parseHfUrl(weight.url).path!, folders));
  }
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
  ).toEqual([{ id: 'a', file: 'a.safetensors', url: URL_VAE, sha256: sha, size: 12, folder: 'vae' }]);
});
