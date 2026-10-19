import { fileURLToPath } from 'node:url';
import { AVATAR_DEFAULT_PROMPT, compileAvatar, compileEdit, compileMusic, compileSpeech, compileUpscale, CompileError, EDIT_LOOKS, loadLibrary, UPSCALE_TARGETS, type ApiWorkflow, type Aspect, type Library } from '../src/index';

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

  test('an aspect without a 1080p size is a CompileError, as from an untyped caller', () => {
    expect(() => compile({ aspect: '4:3' as Aspect })).toThrow(CompileError);
    expect(() => compile({ aspect: '4:3' as Aspect })).toThrow(/aspect "4:3".*16:9, 9:16 or 1:1/);
  });

  test('the output is node 76, video', () => {
    expect(compile().output).toEqual({ node: '76', kind: 'video' });
  });

  test('the shipped workflow cuts the clip in chunks of 33 frames with an overlap of 3', () => {
    const chunk = upscale().template['99']!.inputs;
    expect(chunk).toMatchObject({ chunking_mode: 'manual', 'chunking_mode.frames_per_chunk': 33, temporal_overlap: 3 });
  });
});

describe('compileEdit (Qwen-Image-Edit-2511)', () => {
  const edit = () => extension('qwen-image-edit-2511');
  const compile = (inputs: Partial<Parameters<typeof compileEdit>[2]> = {}) =>
    compileEdit(edit().model, edit().template, { imageRef: 'start.png', instruction: 'make it night', seed: 4, ...inputs }, lib.lock);

  test('by default the Lightning LoRA runs 4 steps at cfg 1, with no look and no second image', () => {
    const { workflow, params } = compile();
    expect(workflow['171']!.inputs.model).toEqual(['161', 0]);
    expect(workflow['145']!.inputs.model).toEqual(['171', 0]);
    expect(workflow['169']!.inputs).toMatchObject({ steps: 4, cfg: 1 });
    expect(workflow['170']).toBeUndefined();
    expect(workflow['42']).toBeUndefined();
    expect(workflow['151']!.inputs.image2).toBeUndefined();
    expect(workflow['149']!.inputs.image2).toBeUndefined();
    expect(params).toMatchObject({ fast: true, look: null });
  });

  test('fast: false drops the Lightning LoRA and runs 40 steps at cfg 4', () => {
    const { workflow } = compile({ fast: false });
    expect(workflow['171']).toBeUndefined();
    expect(workflow['145']!.inputs.model).toEqual(['161', 0]);
    expect(workflow['169']!.inputs).toMatchObject({ steps: 40, cfg: 4 });
  });

  test('a look loads its LoRA file from the lock, before the Lightning LoRA', () => {
    const { workflow, params } = compile({ look: 'action' });
    expect(workflow['170']!.inputs).toMatchObject({ lora_name: lib.lock.get('systms-action-qwen-edit-2511')!.file, strength_model: 1, model: ['161', 0] });
    expect(workflow['171']!.inputs.model).toEqual(['170', 0]);
    expect(params.look).toBe('action');
  });

  test('a look without the Lightning LoRA feeds the model sampling directly', () => {
    expect(compile({ look: 'infl8', fast: false }).workflow['145']!.inputs.model).toEqual(['170', 0]);
  });

  test('the angles look starts the instruction with <sks> and runs at strength 0.9', () => {
    expect(compile({ look: 'angles', instruction: 'front view eye-level shot medium shot' }).workflow['151']!.inputs.prompt).toBe('<sks> front view eye-level shot medium shot');
    const { workflow } = compile({ look: 'angles', instruction: '<sks> back view high-angle shot close-up' });
    expect(workflow['151']!.inputs.prompt).toBe('<sks> back view high-angle shot close-up');
    expect(workflow['170']!.inputs.strength_model).toBe(0.9);
  });

  test('a second image goes to both encoders', () => {
    const { workflow } = compile({ image2Ref: 'uploads/outfit.png' });
    expect(workflow['42']!.inputs.image).toBe('uploads/outfit.png');
    expect(workflow['151']!.inputs.image2).toEqual(['42', 0]);
    expect(workflow['149']!.inputs.image2).toEqual(['42', 0]);
  });

  test('every look is a lock weight of the edit extension that the edit model loads', () => {
    for (const look of Object.values(EDIT_LOOKS)) {
      expect(lib.lock.get(look.lock)?.extension).toBe('edit');
      expect(edit().model.weights).toContain(look.lock);
    }
  });

  test('a template without the Lightning node is a CompileError', () => {
    const template = structuredClone(edit().template);
    delete template['171'];
    expect(() => compileEdit(edit().model, template, { imageRef: 'start.png', instruction: 'make it night', seed: 4 }, lib.lock)).toThrow(/171/);
  });

  test('the instruction goes to the positive encoder only', () => {
    const { workflow, params } = compile({ instruction: '  remove the car  ' });
    expect(workflow['151']!.inputs.prompt).toBe('remove the car');
    expect(workflow['149']!.inputs.prompt).toBe('');
    expect(params.instruction).toBe('remove the car');
  });

  test('an empty or blank instruction is refused', () => {
    expect(() => compile({ instruction: '' })).toThrow(CompileError);
    expect(() => compile({ instruction: ' \n ' })).toThrow(CompileError);
  });

  test('an instruction over 500 characters is refused', () => {
    expect(() => compile({ instruction: 'a'.repeat(501) })).toThrow(/500/);
  });

  test('the image is bound to LoadImage and the seed to the sampler', () => {
    const { workflow } = compile({ imageRef: 'uploads/photo.png', seed: 12 });
    expect(workflow['41']!.inputs.image).toBe('uploads/photo.png');
    expect(workflow['169']!.inputs.seed).toBe(12);
  });

  test('the output is node 9, image', () => {
    expect(compile().output).toEqual({ node: '9', kind: 'image' });
  });

  test('both reference methods of the shipped workflow are index_timestep_zero, the method of 2511', () => {
    const { template } = edit();
    expect([template['147']!.inputs.reference_latents_method, template['148']!.inputs.reference_latents_method]).toEqual([
      'index_timestep_zero',
      'index_timestep_zero',
    ]);
  });
});

describe('compileSpeech (Chatterbox Multilingual V3)', () => {
  const voice = () => extension('chatterbox-mtl-voice');
  const compile = (inputs: Partial<Parameters<typeof compileSpeech>[2]> = {}) =>
    compileSpeech(voice().model, voice().template, { text: 'Bonjour, je suis votre avatar.', language: 'fr', seed: 8, ...inputs });

  test('French speech gets cfg_weight 0, English 0.5', () => {
    expect(compile({ language: 'fr' }).workflow['2']!.inputs).toMatchObject({ language: 'fr', cfg_weight: 0 });
    expect(compile({ language: 'en' }).workflow['2']!.inputs).toMatchObject({ language: 'en', cfg_weight: 0.5 });
  });

  test('a language other than en or fr is a CompileError, as from an untyped caller', () => {
    expect(() => compile({ language: 'de' as 'en' })).toThrow(CompileError);
    expect(() => compile({ language: 'de' as 'en' })).toThrow(/language "de".*en or fr/);
  });

  test('square brackets are removed from the text', () => {
    expect(compile({ text: 'Hello [laugh] there [pause]' }).params.text).toBe('Hello laugh there pause');
  });

  test('an empty text, or one over 300 characters, is refused', () => {
    expect(() => compile({ text: '  ' })).toThrow(CompileError);
    expect(() => compile({ text: '[]' })).toThrow(CompileError);
    expect(() => compile({ text: 'a'.repeat(301) })).toThrow(/300/);
  });

  test('seed 0 is written as 1: the node reads 0 as random', () => {
    expect(compile({ seed: 0 }).workflow['2']!.inputs.seed).toBe(1);
    expect(compile({ seed: 41 }).workflow['2']!.inputs.seed).toBe(41);
  });

  test('no reference clip is connected: the built-in voice speaks', () => {
    const { workflow } = compile();
    expect(workflow['2']!.inputs.audio_prompt).toBeUndefined();
    expect(Object.values(workflow).some((node) => node.class_type === 'LoadAudio')).toBe(false);
  });

  test('the output is node 3, audio', () => {
    expect(compile().output).toEqual({ node: '3', kind: 'audio' });
  });

  test('the shipped workflow pads no short text with "hmm"', () => {
    expect(voice().template['2']!.inputs.crash_protection_template).toBe('');
  });
});

describe('compileAvatar (Wan 2.2 S2V)', () => {
  const avatar = () => extension('wan22-s2v-avatar');
  const compile = (inputs: Partial<Parameters<typeof compileAvatar>[2]> = {}) =>
    compileAvatar(avatar().model, avatar().template, { imageRef: 'start.png', audioRef: 'speech.flac', audio_s: 3, aspect: '16:9', seed: 10, ...inputs });
  const extensionNodes = (workflow: ApiWorkflow) => Object.keys(workflow).filter((id) => /^(79|85)0\d\d$/.test(id)).sort();

  test('3 s of speech is one chunk of 48 frames', () => {
    const { workflow, params } = compile({ audio_s: 3 });
    expect(params).toMatchObject({ chunks: 1, frames: 48 });
    expect(extensionNodes(workflow)).toEqual([]);
    expect(workflow['94']!.inputs.samples).toEqual(['3', 0]);
    expect(workflow['95']!.inputs.samples2).toEqual(['3', 0]);
    expect(workflow['96']!.inputs.length).toBe(48);
  });

  test('7 s is two chunks of 112 frames', () => {
    const { workflow, params } = compile({ audio_s: 7 });
    expect(params).toMatchObject({ chunks: 2, frames: 112 });
    expect(extensionNodes(workflow)).toEqual(['79076', '79077', '79078']);
    expect(workflow['94']!.inputs.samples).toEqual(['79078', 0]);
    expect(workflow['95']!.inputs.samples2).toEqual(['79078', 0]);
  });

  test('12.3 s is three chunks of 197 frames, 15 s keeps 237', () => {
    expect(compile({ audio_s: 12.3 }).params).toMatchObject({ chunks: 3, frames: 197 });
    const { workflow, params } = compile({ audio_s: 15 });
    expect(params).toMatchObject({ chunks: 3, frames: 237 });
    expect(workflow['94']!.inputs.samples).toEqual(['85078', 0]);
  });

  test('speech over 15 s, or under 1 s, is refused', () => {
    expect(() => compile({ audio_s: 16 })).toThrow(/15/);
    expect(() => compile({ audio_s: 0.5 })).toThrow(CompileError);
  });

  test('every extension gets the accumulated latent, never the previous chunk alone', () => {
    const { workflow } = compile({ audio_s: 14 });
    expect(workflow['79076']!.inputs.video_latent).toEqual(['3', 0]);
    expect(workflow['85076']!.inputs.video_latent).toEqual(['79078', 0]);
    expect(workflow['85078']!.inputs.samples1).toEqual(['79078', 0]);
  });

  test('the seeds are seed, seed+1, seed+2', () => {
    const { workflow } = compile({ audio_s: 14, seed: 100 });
    expect([workflow['3']!.inputs.seed, workflow['79077']!.inputs.seed, workflow['85077']!.inputs.seed]).toEqual([100, 101, 102]);
  });

  test('a portrait photo renders at 480x832, a square one at 640x640', () => {
    expect(compile({ aspect: '9:16' }).workflow['93']!.inputs).toMatchObject({ width: 480, height: 832 });
    expect(compile({ aspect: '1:1' }).params).toMatchObject({ width: 640, height: 640 });
  });

  test('the photo, the speech and the prompt are bound; an empty prompt gets the talking-head one', () => {
    const { workflow } = compile({ imageRef: 'uploads/face.png', audioRef: 'uploads/voice.flac', prompt: '  ' });
    expect(workflow['52']!.inputs.image).toBe('uploads/face.png');
    expect(workflow['58']!.inputs.audio).toBe('uploads/voice.flac');
    expect(workflow['6']!.inputs.text).toBe(AVATAR_DEFAULT_PROMPT);
    expect(compile({ prompt: 'a chef explains a recipe' }).workflow['6']!.inputs.text).toBe('a chef explains a recipe');
  });

  test('the output is node 113, video', () => {
    expect(compile().output).toEqual({ node: '113', kind: 'video' });
  });
});
