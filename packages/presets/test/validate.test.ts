import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, validatePreset, validatePresetFile, type Library } from '../src/index';

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

test('the library holds the twelve launch presets of spec §6', () => {
  expect([...lib.presets.keys()].sort()).toEqual([
    'breathing', 'crash-push', 'drift-left-push', 'pan-left', 'pan-right', 'pull-back-reveal',
    'pull-back-tilt-up', 'push-and-settle', 'rise-and-push', 'slow-push', 'tilt-down', 'tilt-up',
  ]);
});

describe('validatePresetFile: the schema and the checks of the capability the file names', () => {
  const effect = () => readFile(join(repoRoot(), 'presets', 'effects', 'squish.yaml'), 'utf8');
  const hook = () => readFile(join(repoRoot(), 'presets', 'transitions', 'wardrobe-swap.yaml'), 'utf8');
  /** The library with model `id`'s max_chars lowered to `max`: the schema's own limits never reach the models'. */
  const withMaxChars = (id: string, max: number): Library => {
    const model = lib.extensionModels.get(id)!;
    return { ...lib, extensionModels: new Map(lib.extensionModels).set(id, { ...model, limits: { ...model.limits, max_chars: max } }) };
  };

  test('a camera preset is checked as validatePreset does', () => {
    expect(validatePresetFile(yaml, 'crash-push.yaml', lib)).toMatchObject({ ok: true, preset: { id: 'crash-push', capability: 'i2v-camera' } });
    expect(validatePresetFile(yaml.replace('speed: 1.5', 'sped: 1.5'), 'x.yaml', lib)).toEqual({ ok: false, problems: [expect.stringMatching(/^camera.*sped/)] });
  });

  test('every effect and every hook of the repository is valid', async () => {
    for (const file of [...lib.effectFiles.values(), ...lib.hookFiles.values()]) {
      expect(validatePresetFile(await readFile(join(repoRoot(), file), 'utf8'), file, lib), file).toMatchObject({ ok: true });
    }
  });

  test('an effect is read with the effect schema', async () => {
    expect(validatePresetFile((await effect()).replace(/trigger: .*/, 'trigger: karaoke'), 'squish.yaml', lib)).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^prompt\.template: must contain the trigger "karaoke"/)],
    });
  });

  test('an effect on an unknown model, or on a model of another task', async () => {
    expect(validatePresetFile((await effect()).replace('preferred: wan21-i2v-effects', 'preferred: karaoke'), 'squish.yaml', lib)).toEqual({
      ok: false,
      problems: ['models.preferred: unknown effect model "karaoke"'],
    });
    expect(validatePresetFile((await effect()).replace('preferred: wan21-i2v-effects', 'preferred: qwen-image-edit-2511'), 'squish.yaml', lib)).toEqual({
      ok: false,
      problems: ['models.preferred: model qwen-image-edit-2511 runs task i2i-edit, not i2v-effect'],
    });
  });

  test('an effect whose LoRA is not an effect LoRA of its model', async () => {
    expect(validatePresetFile((await effect()).replace('lora: remade-squish', 'lora: lightx2v-wan21-i2v-480p-4step'), 'squish.yaml', lib)).toEqual({
      ok: false,
      problems: ['effect.lora: LoRA "lightx2v-wan21-i2v-480p-4step" is the 4-step LoRA of model wan21-i2v-effects, not an effect'],
    });
  });

  test('an effect whose LoRA has a restrictive license in the lock', async () => {
    const squish = lib.lock.get('remade-squish')!;
    const restricted: Library = { ...lib, lock: new Map(lib.lock).set('remade-squish', { ...squish, license: 'CC-BY-NC-4.0' }) };
    expect(validatePresetFile(await effect(), 'squish.yaml', restricted)).toEqual({
      ok: false,
      problems: ['effect.lora: license "CC-BY-NC-4.0" is not Apache-2.0 or MIT'],
    });
  });

  test('an effect is dry-compiled on its model: a default subject over its max_chars fails', async () => {
    expect(validatePresetFile(await effect(), 'squish.yaml', withMaxChars('wan21-i2v-effects', 5))).toEqual({
      ok: false,
      problems: ['model wan21-i2v-effects: the subject has 6 characters, over the 5 of model wan21-i2v-effects'],
    });
  });

  test('a hook is read with the transition schema', async () => {
    const r = validatePresetFile((await hook()).replace('motion:', 'moves:'), 'wardrobe-swap.yaml', lib);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^prompt\.moves/), expect.stringMatching(/^prompt\.motion/)]));
  });

  test('a hook on an unknown model, or on a model of another task', async () => {
    expect(validatePresetFile((await hook()).replace('preferred: wan22-flf2v-transition', 'preferred: karaoke'), 'h.yaml', lib)).toEqual({
      ok: false,
      problems: ['models.preferred: unknown transition model "karaoke"'],
    });
    expect(validatePresetFile((await hook()).replace('preferred: wan22-flf2v-transition', 'preferred: wan21-i2v-effects'), 'h.yaml', lib)).toEqual({
      ok: false,
      problems: ['models.preferred: model wan21-i2v-effects runs task i2v-effect, not flf2v'],
    });
  });

  test('a hook is dry-compiled: its end frame on the edit model, then its transition', async () => {
    expect(validatePresetFile(await hook(), 'h.yaml', withMaxChars('qwen-image-edit-2511', 10))).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^model qwen-image-edit-2511: the edit instruction has \d+ characters, over the 10 of model qwen-image-edit-2511$/)],
    });
    expect(validatePresetFile(await hook(), 'h.yaml', withMaxChars('wan22-flf2v-transition', 10))).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^model wan22-flf2v-transition: the motion prompt has \d+ characters, over the 10 of model wan22-flf2v-transition$/)],
    });
  });

  test('a hook needs an edit model to make its end frame', async () => {
    const noEdit = { ...lib, extensionModels: new Map([...lib.extensionModels].filter(([, model]) => model.task !== 'i2i-edit')) };
    expect(validatePresetFile(await hook(), 'h.yaml', noEdit)).toEqual({ ok: false, problems: ['no edit model (task i2i-edit) to make the end frame'] });
  });
});
