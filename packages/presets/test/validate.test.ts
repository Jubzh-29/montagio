import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, validatePreset, type Library } from '../src/index';

const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
let yaml: string;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot());
  yaml = await readFile(join(repoRoot(), 'presets', 'crash-push.yaml'), 'utf8');
});

test('a repository preset is valid', () => {
  expect(validatePreset(yaml, 'crash-push.yaml', lib)).toMatchObject({ ok: true, preset: { id: 'crash-push' } });
});

test('schema problems are listed one per field', () => {
  const r = validatePreset(yaml.replace('speed: 1.5', 'sped: 1.5').replace('duration_s: 5', 'duration_s: 11'), 'x.yaml', lib);
  expect(r).toEqual({
    ok: false,
    problems: [expect.stringMatching(/^camera.*sped/), expect.stringMatching(/^defaults\.duration_s/)],
  });
});

test('unknown preferred model is named', () => {
  expect(validatePreset(yaml.replace('preferred: wan22-i2v-a14b-fun-camera', 'preferred: nope'), 'x.yaml', lib)).toEqual({
    ok: false,
    problems: [expect.stringMatching(/^models\.preferred: unknown model "nope"/)],
  });
});

test('an image model as fallback fails the dry compile', () => {
  const r = validatePreset(yaml.replace('fallback: wan22-ti2v-5b', 'fallback: z-image-turbo'), 'x.yaml', lib);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.problems).toContainEqual(expect.stringMatching(/^model z-image-turbo: /));
});

test('a LoRA outside the lock is reported, and refused by the compiler', () => {
  const r = validatePreset(`${yaml}loras:\n  - { file: style.safetensors, strength: 1 }\n`, 'x.yaml', lib);
  if (r.ok) throw new Error('expected problems');
  expect(r.problems).toContainEqual('loras[0].file: style.safetensors is not in registry/models.lock.yaml');
  expect(r.problems).toContainEqual(expect.stringMatching(/^model wan22-i2v-a14b-fun-camera: .*LoRA/i));
});

test('a LoRA whose lock entry has a restrictive license is reported', () => {
  const locked = [...lib.lock.values()][0]!;
  const restricted = { ...lib, lock: new Map([[locked.id, { ...locked, license: 'CC-BY-NC-4.0' }]]) };
  const r = validatePreset(`${yaml}loras:\n  - { file: ${locked.file}, strength: 1 }\n`, 'x.yaml', restricted);
  if (r.ok) throw new Error('expected problems');
  expect(r.problems).toContainEqual(`loras[0].file: license "CC-BY-NC-4.0" is not Apache-2.0 or MIT`);
});

test('modelId restricts the dry compile to that model', () => {
  expect(validatePreset(yaml, 'x.yaml', lib, { modelId: 'z-image-turbo' }).ok).toBe(false);
  expect(validatePreset(yaml, 'x.yaml', lib, { modelId: 'wan22-ti2v-5b' }).ok).toBe(true);
  expect(validatePreset(yaml, 'x.yaml', lib, { modelId: 'nope' })).toEqual({ ok: false, problems: ['model nope: unknown model'] });
});

test('invalid YAML is one problem', () => {
  expect(validatePreset('id: [', 'x.yaml', lib)).toEqual({ ok: false, problems: [expect.stringMatching(/^invalid YAML/)] });
});

test('every repository preset validates against its preferred and fallback models', async () => {
  for (const [id, file] of lib.presetFiles) {
    expect(validatePreset(await readFile(join(repoRoot(), file), 'utf8'), file, lib), id).toMatchObject({ ok: true });
  }
});
