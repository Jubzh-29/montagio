import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileHookEdit,
  compileHookTransition,
  compileTransition,
  CompileError,
  LibraryError,
  loadLibrary,
  parseTransitionPreset,
  type Library,
} from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const hookYaml = (endFrame = '  instruction: "A macro of the iris."', extra = '') => `schema: montagio/preset@0.1
id: test-hook
name: Test hook
preview: previews/test-hook.mp4
license: CC-BY-4.0
author: test
capability: i2v-transition
end_frame:
${endFrame}
prompt:
  motion: "The camera pushes into the eye."
models:
  preferred: wan22-flf2v-transition
${extra}`;

describe('hook presets (montagio/preset@0.1, capability i2v-transition)', () => {
  test('defaults: one reference image, no look, 5 s', () => {
    const hook = parseTransitionPreset(hookYaml(), 'h.yaml');
    expect(hook.end_frame).toEqual({ instruction: 'A macro of the iris.', references: 1 });
    expect(hook.defaults.duration_s).toBe(5);
  });

  test('a look must be one of the edit looks', () => {
    expect(() => parseTransitionPreset(hookYaml('  instruction: "x"\n  look: karaoke'), 'h.yaml')).toThrow(/end_frame\.look/);
  });

  test('two reference images at most', () => {
    expect(() => parseTransitionPreset(hookYaml('  instruction: "x"\n  references: 3'), 'h.yaml')).toThrow(/references/);
  });

  test('the four hooks load apart from the camera presets and the effects', () => {
    expect([...lib.hooks.keys()].sort()).toEqual(['eyes-in', 'figurine', 'ignite', 'outfit-morph']);
    expect(lib.hookFiles.get('eyes-in')).toBe('presets/transitions/eyes-in.yaml');
    expect(lib.presets.has('eyes-in')).toBe(false);
    expect(lib.effects.has('eyes-in')).toBe(false);
  });

  test('a hook on a model of another task, or on an unknown one, is a library problem', async () => {
    const repoWith = (files: Record<string, string>) => {
      const root = join(mkdtempSync(join(tmpdir(), 'montagio-hook-')), 'repo');
      for (const dir of ['presets', 'registry', 'workflows']) cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
      for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
      return root;
    };
    const eyes = readFileSync(join(repoRoot, 'presets', 'transitions', 'eyes-in.yaml'), 'utf8');
    for (const [model, problem] of [
      ['wan21-i2v-effects', /hook eyes-in: model wan21-i2v-effects runs task i2v-effect, not flf2v/],
      ['karaoke', /hook eyes-in: unknown transition model "karaoke"/],
    ] as const) {
      const error = await loadLibrary(repoWith({ 'presets/transitions/eyes-in.yaml': eyes.replace('preferred: wan22-flf2v-transition', `preferred: ${model}`) })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LibraryError);
      expect((error as LibraryError).problems.join('\n')).toMatch(problem);
    }
  });
});

describe('compileTransition (Wan 2.2 FLF2V)', () => {
  const flf2v = () => {
    const model = lib.extensionModels.get('wan22-flf2v-transition')!;
    return { model, template: lib.extensionTemplates.get(model.workflow)! };
  };
  const compile = (inputs: Partial<Parameters<typeof compileTransition>[2]> = {}) =>
    compileTransition(flf2v().model, flf2v().template, { startRef: 'start.png', endRef: 'end.png', prompt: 'the camera pushes in', seed: 6, aspect: '16:9', ...inputs });

  test('the start and end images, the prompt and the seed', () => {
    const { workflow, output } = compile({ startRef: 'uploads/a.png', endRef: 'outputs/b.png', seed: 11 });
    expect(workflow['68']!.inputs.image).toBe('uploads/a.png');
    expect(workflow['62']!.inputs.image).toBe('outputs/b.png');
    expect(workflow['6']!.inputs.text).toBe('the camera pushes in');
    expect(workflow['57']!.inputs.noise_seed).toBe(11);
    expect(output).toEqual({ node: '61', kind: 'video' });
  });

  test('every aspect keeps its shape at 480p', () => {
    expect(compile({ aspect: '16:9' }).workflow['67']!.inputs).toMatchObject({ width: 832, height: 480 });
    expect(compile({ aspect: '9:16' }).workflow['67']!.inputs).toMatchObject({ width: 480, height: 832 });
    expect(compile({ aspect: '1:1' }).workflow['67']!.inputs).toMatchObject({ width: 640, height: 640 });
  });

  test('4n+1 frames at 16 fps: 5 s gives 81, 3 s gives 49', () => {
    expect(compile().workflow['67']!.inputs.length).toBe(81);
    expect(compile({ duration_s: 3 }).workflow['67']!.inputs.length).toBe(49);
  });

  test('a duration outside 2 to 5 s, or an empty prompt, is refused', () => {
    expect(() => compile({ duration_s: 6 })).toThrow(CompileError);
    expect(() => compile({ duration_s: 1 })).toThrow(CompileError);
    expect(() => compile({ prompt: '  ' })).toThrow(CompileError);
  });

  test('by default the two 4-step LoRAs run: 4 steps at cfg 1, the experts split at step 2, shift 5', () => {
    const { workflow } = compile();
    expect(workflow['54']!.inputs).toMatchObject({ shift: 5, model: ['91', 0] });
    expect(workflow['55']!.inputs).toMatchObject({ shift: 5, model: ['92', 0] });
    expect(workflow['57']!.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 0, end_at_step: 2 });
    expect(workflow['58']!.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 2 });
  });

  test("fast: false is the template's 20-step path: no LoRA, cfg 4, split at step 10, shift 8", () => {
    const { workflow } = compile({ fast: false });
    expect(workflow['91']).toBeUndefined();
    expect(workflow['92']).toBeUndefined();
    expect(workflow['54']!.inputs).toMatchObject({ shift: 8, model: ['37', 0] });
    expect(workflow['55']!.inputs).toMatchObject({ shift: 8, model: ['56', 0] });
    expect(workflow['57']!.inputs).toMatchObject({ steps: 20, cfg: 4, end_at_step: 10 });
    expect(workflow['58']!.inputs).toMatchObject({ steps: 20, cfg: 4, start_at_step: 10 });
  });
});

describe('a hook: the end frame by the edit, then the transition', () => {
  const edit = () => {
    const model = lib.extensionModels.get('qwen-image-edit-2511')!;
    return { model, template: lib.extensionTemplates.get(model.workflow)! };
  };
  const flf2v = () => {
    const model = lib.extensionModels.get('wan22-flf2v-transition')!;
    return { model, template: lib.extensionTemplates.get(model.workflow)! };
  };
  const hookEdit = (id: string, inputs: Partial<Parameters<typeof compileHookEdit>[3]> = {}) =>
    compileHookEdit(lib.hooks.get(id)!, edit().model, edit().template, { imageRef: 'start.png', seed: 2, ...inputs }, lib.lock);

  test('eyes-in: the instruction of the hook, no look, no second image', () => {
    const { workflow } = hookEdit('eyes-in');
    expect(workflow['151']!.inputs.prompt).toBe(lib.hooks.get('eyes-in')!.end_frame.instruction);
    expect(workflow['170']).toBeUndefined();
    expect(workflow['42']).toBeUndefined();
  });

  test('outfit-morph needs the outfit image', () => {
    expect(() => hookEdit('outfit-morph')).toThrow(/outfit-morph needs a second image/);
    expect(hookEdit('outfit-morph', { image2Ref: 'uploads/outfit.png' }).workflow['42']!.inputs.image).toBe('uploads/outfit.png');
  });

  test('a hook with one reference image ignores a second one', () => {
    expect(hookEdit('eyes-in', { image2Ref: 'uploads/outfit.png' }).workflow['42']).toBeUndefined();
  });

  test('figurine runs the ACTION look', () => {
    expect(hookEdit('figurine').workflow['170']!.inputs.lora_name).toBe(lib.lock.get('systms-action-qwen-edit-2511')!.file);
  });

  test("the transition starts on the photo and ends on the edit's output, with the hook's motion", () => {
    const hook = lib.hooks.get('eyes-in')!;
    const { workflow } = compileHookTransition(hook, flf2v().model, flf2v().template, { imageRef: 'start.png', endRef: 'edit_00001_.png', seed: 2, aspect: '9:16' });
    expect(workflow['68']!.inputs.image).toBe('start.png');
    expect(workflow['62']!.inputs.image).toBe('edit_00001_.png');
    expect(workflow['6']!.inputs.text).toBe(hook.prompt.motion);
    expect(workflow['67']!.inputs).toMatchObject({ width: 480, height: 832, length: 81 });
  });
});
