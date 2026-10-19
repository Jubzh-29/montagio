import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEffect, CompileError, LibraryError, loadLibrary, parseEffectPreset, type Library } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const preset = (template = '"The {subject} gets a sq41sh squish effect."', extra = '') => `schema: montagio/preset@0.1
id: test-squish
name: Test squish
preview: previews/test-squish.mp4
license: CC-BY-4.0
author: test
capability: i2v-effect
effect:
  lora: remade-squish
  trigger: sq41sh squish effect
prompt:
  template: ${template}
models:
  preferred: wan21-i2v-effects
${extra}`;

describe('effect presets (montagio/preset@0.1, capability i2v-effect)', () => {
  test('defaults: strength 1, subject "subject", 5 s, no negative', () => {
    expect(parseEffectPreset(preset(), 'p.yaml')).toMatchObject({
      effect: { lora: 'remade-squish', strength: 1, trigger: 'sq41sh squish effect' },
      prompt: { subject: 'subject', negative: '' },
      defaults: { duration_s: 5 },
    });
  });

  test('a template without the trigger is refused', () => {
    expect(() => parseEffectPreset(preset('"The {subject} gets squished."'), 'p.yaml')).toThrow(/prompt\.template.*sq41sh squish effect/);
  });

  test('a template without {subject} is refused', () => {
    expect(() => parseEffectPreset(preset('"A sq41sh squish effect."'), 'p.yaml')).toThrow(/prompt\.template.*\{subject\}/);
  });

  test('an effect lasts 2 to 5 s', () => {
    expect(() => parseEffectPreset(preset(undefined, 'defaults: { duration_s: 6 }\n'), 'p.yaml')).toThrow(/duration_s/);
  });

  test('a camera preset is not an effect preset', () => {
    expect(() => parseEffectPreset(preset().replace('capability: i2v-effect', 'capability: i2v-camera'), 'p.yaml')).toThrow(/capability/);
  });

  test('the six effects of the pack load apart from the camera presets', () => {
    expect([...lib.effects.keys()].sort()).toEqual(['bullet-time', 'cakeify', 'crash-zoom-in', 'explode', 'orbit-360', 'squish']);
    expect([...lib.presets.values()].every((p) => p.capability === 'i2v-camera')).toBe(true);
    expect(lib.presets.has('squish')).toBe(false);
    expect(lib.effectFiles.get('squish')).toBe('presets/effects/squish.yaml');
  });
});

describe('the library checks each effect against its model and the lock', () => {
  /** A copy of the repository's library (presets, registry, workflows) with `files` written over it. */
  const repoWith = (files: Record<string, string>) => {
    const root = join(mkdtempSync(join(tmpdir(), 'montagio-fx-')), 'repo');
    for (const dir of ['presets', 'registry', 'workflows']) cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    return root;
  };
  const squish = () => readFileSync(join(repoRoot, 'presets', 'effects', 'squish.yaml'), 'utf8');
  const problemsOf = async (files: Record<string, string>) => {
    const error = await loadLibrary(repoWith(files)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LibraryError);
    return (error as LibraryError).problems.join('\n');
  };

  test('an unknown LoRA', async () => {
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('lora: remade-squish', 'lora: remade-karaoke') })).toMatch(
      /effect squish: LoRA "remade-karaoke" is not a weight of model wan21-i2v-effects/,
    );
  });

  test('a LoRA of another extension', async () => {
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('lora: remade-squish', 'lora: systms-infl8-qwen-edit-2511') })).toMatch(
      /effect squish: LoRA "systms-infl8-qwen-edit-2511" is not a weight of model wan21-i2v-effects/,
    );
  });

  test.each(['wan21-i2v-480p-14b-fp8', 'clip-vision-h', 'wan21-vae'])('a weight of the model outside folder loras (%s)', async (id) => {
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('lora: remade-squish', `lora: ${id}`) })).toMatch(
      new RegExp(`effect squish: LoRA "${id}" is not in folder loras`),
    );
  });

  test('the 4-step LoRA of the model', async () => {
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('lora: remade-squish', 'lora: lightx2v-wan21-i2v-480p-4step') })).toMatch(
      /effect squish: LoRA "lightx2v-wan21-i2v-480p-4step" is the 4-step LoRA of model wan21-i2v-effects, not an effect/,
    );
  });

  test('a model of another task, or an unknown one', async () => {
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('preferred: wan21-i2v-effects', 'preferred: qwen-image-edit-2511') })).toMatch(
      /effect squish: model qwen-image-edit-2511 runs task i2i-edit, not i2v-effect/,
    );
    expect(await problemsOf({ 'presets/effects/squish.yaml': squish().replace('preferred: wan21-i2v-effects', 'preferred: karaoke') })).toMatch(
      /effect squish: unknown effect model "karaoke"/,
    );
  });

  test('two effects with the same id', async () => {
    expect(await problemsOf({ 'presets/effects/squish-again.yaml': squish() })).toMatch(/duplicate effect id "squish"/);
  });
});

describe('compileEffect (Wan 2.1 I2V 480p + an effect LoRA)', () => {
  const fx = () => {
    const model = lib.extensionModels.get('wan21-i2v-effects')!;
    return { model, template: lib.extensionTemplates.get(model.workflow)! };
  };
  const compile = (id = 'squish', inputs: Partial<Parameters<typeof compileEffect>[3]> = {}) =>
    compileEffect(lib.effects.get(id)!, fx().model, fx().template, { imageRef: 'start.png', seed: 5, aspect: '16:9', ...inputs }, lib.lock);

  test('832x480, 81 frames at 16 fps, the photo and the seed', () => {
    const { workflow, params, output } = compile('squish', { imageRef: 'uploads/cat.png', seed: 9 });
    expect(workflow['50']!.inputs).toMatchObject({ width: 832, height: 480, length: 81 });
    expect(workflow['52']!.inputs.image).toBe('uploads/cat.png');
    expect(workflow['3']!.inputs.seed).toBe(9);
    expect(params).toMatchObject({ width: 832, height: 480, frames: 81, seed: 9 });
    expect(output).toEqual({ node: '56', kind: 'video' });
  });

  test('a portrait or square photo keeps its shape: 480x832, 640x640', () => {
    expect(compile('squish', { aspect: '9:16' }).workflow['50']!.inputs).toMatchObject({ width: 480, height: 832 });
    expect(compile('squish', { aspect: '1:1' }).workflow['50']!.inputs).toMatchObject({ width: 640, height: 640 });
  });

  test('the prompt is the template with the subject, trigger included', () => {
    const { workflow, params } = compile('squish', { subject: '  red toy car ' });
    expect(params.prompt).toContain('red toy car');
    expect(params.prompt).toContain('sq41sh squish effect');
    expect(params.prompt).not.toContain('{subject}');
    expect(workflow['6']!.inputs.text).toBe(params.prompt);
    expect(compile('squish').params.prompt).toContain(lib.effects.get('squish')!.prompt.subject);
  });

  test('an empty subject is refused before any GPU', () => {
    expect(() => compile('squish', { subject: '  ' })).toThrow(CompileError);
  });

  test('each effect loads its own LoRA file from the lock', () => {
    const files = [...lib.effects.values()].map((effect) => {
      const { workflow } = compile(effect.id);
      expect(workflow['200']!.inputs.lora_name).toBe(lib.lock.get(effect.effect.lora)!.file);
      expect(workflow['200']!.inputs.strength_model).toBe(effect.effect.strength);
      return workflow['200']!.inputs.lora_name;
    });
    expect(new Set(files).size).toBe(6);
  });

  test('by default the 4-step LoRA runs at cfg 1, after the effect LoRA', () => {
    const { workflow } = compile();
    expect(workflow['200']!.inputs.model).toEqual(['37', 0]);
    expect(workflow['201']!.inputs.model).toEqual(['200', 0]);
    expect(workflow['54']!.inputs).toMatchObject({ shift: 5, model: ['201', 0] });
    expect(workflow['3']!.inputs).toMatchObject({ steps: 4, cfg: 1, sampler_name: 'euler' });
  });

  test('fast: false drops the 4-step LoRA: 20 steps at cfg 6, as the effect cards advise', () => {
    const { workflow } = compile('squish', { fast: false });
    expect(workflow['201']).toBeUndefined();
    expect(workflow['54']!.inputs.model).toEqual(['200', 0]);
    expect(workflow['3']!.inputs).toMatchObject({ steps: 20, cfg: 6, sampler_name: 'uni_pc' });
  });

  test("a preset without a negative keeps the template's", () => {
    expect(compile().workflow['7']!.inputs.text).toBe(fx().template['7']!.inputs.text);
  });

  test('a subject over the max_chars of the model is refused before any GPU', () => {
    expect(() => compile('squish', { subject: 'x'.repeat(121) })).toThrow(/the subject has 121 characters, over the 120 of model wan21-i2v-effects/);
    expect(compile('squish', { subject: 'x'.repeat(120) }).params.prompt).toContain('x'.repeat(120));
  });

  const withLora = (lora: string) => ({ ...lib.effects.get('squish')!, effect: { ...lib.effects.get('squish')!.effect, lora } });
  const compileWith = (lora: string) => () => compileEffect(withLora(lora), fx().model, fx().template, { imageRef: 'start.png', seed: 1, aspect: '16:9' }, lib.lock);

  test('a LoRA outside the model is refused', () => {
    expect(compileWith('systms-infl8-qwen-edit-2511')).toThrow(CompileError);
    expect(compileWith('systms-infl8-qwen-edit-2511')).toThrow(/LoRA "systms-infl8-qwen-edit-2511" is not a weight of model wan21-i2v-effects/);
  });

  test('a weight of the model that is not an effect LoRA is refused: the base model, the 4-step LoRA', () => {
    expect(compileWith('wan21-i2v-480p-14b-fp8')).toThrow(CompileError);
    expect(compileWith('wan21-i2v-480p-14b-fp8')).toThrow(/LoRA "wan21-i2v-480p-14b-fp8" is not in folder loras/);
    expect(compileWith('lightx2v-wan21-i2v-480p-4step')).toThrow(CompileError);
    expect(compileWith('lightx2v-wan21-i2v-480p-4step')).toThrow(/is the 4-step LoRA of model wan21-i2v-effects/);
  });

  test('an effect made for another model is refused', () => {
    const other = { ...lib.effects.get('squish')!, models: { preferred: 'karaoke' } };
    expect(() => compileEffect(other, fx().model, fx().template, { imageRef: 'start.png', seed: 1, aspect: '16:9' }, lib.lock)).toThrow(/karaoke/);
  });
});
