import { fileURLToPath } from 'node:url';
import { compileMusic, compileUpscale, CompileError, loadLibrary, UPSCALE_TARGETS, type ApiWorkflow, type Library } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

/** An extension model of the repository and its workflow template. */
const extension = (id: string) => {
  const model = lib.extensionModels.get(id);
  if (!model) throw new Error(`no extension model ${id}`);
  return { model, template: lib.extensionTemplates.get(model.workflow)! };
};

describe('compileMusic (ACE-Step 1.5)', () => {
  const music = () => extension('ace-step15-music');
  const compile = (inputs: Partial<Parameters<typeof compileMusic>[2]> = {}) =>
    compileMusic(music().model, music().template, { prompt: 'tense synth pulse', duration_s: 12, seed: 7, ...inputs });

  test('writes the duration and the seed to both of their fields', () => {
    const { workflow } = compile({ duration_s: 12, seed: 42 });
    expect(workflow['98']!.inputs.seconds).toBe(12);
    expect(workflow['94']!.inputs.duration).toBe(12);
    expect(workflow['3']!.inputs.seed).toBe(42);
    expect(workflow['94']!.inputs.seed).toBe(42);
  });

  test('a 7.3 s film gets 10 s of music, a 14.2 s film 15 s', () => {
    expect(compile({ duration_s: 7.3 }).params.duration_s).toBe(10);
    expect(compile({ duration_s: 14.2 }).params.duration_s).toBe(15);
  });

  test('instrumental is added to the description once', () => {
    expect(compile({ prompt: '  tense synth pulse ' }).workflow['94']!.inputs.tags).toBe('tense synth pulse, instrumental');
    expect(compile({ prompt: 'Instrumental lo-fi piano' }).workflow['94']!.inputs.tags).toBe('Instrumental lo-fi piano');
  });

  test('the lyrics stay [Instrumental]', () => {
    expect(compile().workflow['94']!.inputs.lyrics).toBe('[Instrumental]');
  });

  test('an empty description is refused', () => {
    expect(() => compile({ prompt: '   ' })).toThrow(CompileError);
  });

  test('a description over 300 characters is refused', () => {
    expect(() => compile({ prompt: 'a'.repeat(301) })).toThrow(/300/);
    expect(() => compile({ prompt: 'a'.repeat(300) })).not.toThrow();
  });

  test('a film longer than 60 s is refused', () => {
    expect(() => compile({ duration_s: 60.5 })).toThrow(/60/);
    expect(compile({ duration_s: 60 }).params.duration_s).toBe(60);
  });

  test('bpm outside 10–300 is refused, 90 by default', () => {
    expect(compile().params.bpm).toBe(90);
    expect(compile({ bpm: 128 }).workflow['94']!.inputs.bpm).toBe(128);
    for (const bpm of [9, 301, 120.5]) expect(() => compile({ bpm })).toThrow(/bpm/);
  });

  test('a binding to a node the template lacks is a CompileError', () => {
    const { model, template } = music();
    const { '98': _latent, ...withoutLatent } = template;
    expect(() => compileMusic(model, withoutLatent as ApiWorkflow, { prompt: 'x', duration_s: 12, seed: 1 })).toThrow(/duration_s → node 98/);
  });

  test('the output is node 107, audio, and the template is not modified', () => {
    const before = JSON.stringify(music().template);
    expect(compile().output).toEqual({ node: '107', kind: 'audio' });
    expect(JSON.stringify(music().template)).toBe(before);
  });

  test('a model of another task is refused', () => {
    const { model, template } = music();
    expect(() => compileMusic({ ...model, task: 'i2i-edit' }, template, { prompt: 'x', duration_s: 12, seed: 1 })).toThrow(/t2a/);
  });
});

describe('compileUpscale (SeedVR2 3B)', () => {
  const upscale = () => extension('seedvr2-upscale');
  const compile = (inputs: Partial<Parameters<typeof compileUpscale>[2]> = {}) =>
    compileUpscale(upscale().model, upscale().template, { videoRef: 'clip.mp4', aspect: '16:9', seed: 5, ...inputs });

  test('a 16:9 clip goes to 1920x1080, a 9:16 one to 1080x1920, a square one to 1080x1080', () => {
    for (const [aspect, width, height] of [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080]] as const) {
      const { workflow, params } = compile({ aspect });
      expect({ aspect, width: workflow['57']!.inputs['resize_type.width'], height: workflow['57']!.inputs['resize_type.height'] }).toEqual({ aspect, width, height });
      expect(params).toMatchObject({ width, height });
    }
    expect(UPSCALE_TARGETS['9:16']).toEqual({ width: 1080, height: 1920 });
  });

  test('the clip is bound to LoadVideo.file and the seed to the sampler', () => {
    const { workflow } = compile({ videoRef: 'uploads/abc.mp4', seed: 99 });
    expect(workflow['73']!.inputs.file).toBe('uploads/abc.mp4');
    expect(workflow['54']!.inputs.seed).toBe(99);
  });

  test('a clip over 121 frames is refused', () => {
    expect(() => compile({ frames: 122 })).toThrow(/121/);
    expect(() => compile({ frames: 121 })).not.toThrow();
  });

  test('the output is node 76, video', () => {
    expect(compile().output).toEqual({ node: '76', kind: 'video' });
  });

  test('the shipped workflow cuts the clip in chunks of 33 frames with an overlap of 3', () => {
    const chunk = upscale().template['99']!.inputs;
    expect(chunk).toMatchObject({ chunking_mode: 'manual', 'chunking_mode.frames_per_chunk': 33, temporal_overlap: 3 });
  });
});
