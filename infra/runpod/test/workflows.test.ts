/**
 * The workflows of the repository and every preset compiled with them, checked offline
 * against what ComfyUI v0.41.0 declares.
 *
 * fixtures/object_info-v0.41.0.json is the /object_info of a real ComfyUI v0.41.0 (commit
 * 98cc0bf8, started with --cpu --disable-partner-nodes and the Montagio node pack, on
 * 2026-10-18), cut down to the classes of workflows/*.api.json plus WanCameraEmbedding and
 * MontagioCameraEmbedding, tooltips removed. The weight lists of the loaders are the files of
 * registry/models.lock.yaml; LoadImage lists start.png. When a workflow gains a class, take
 * that class from the /object_info of the GPU session, not from memory.
 * The classes of the extension workflows come from the same ComfyUI on 2026-10-19, once
 * kornia (a requirement of ComfyUI that the CPU install lacked) was in its venv: without it,
 * nodes_latent and nodes_post_processing do not load. LoadVideo lists clip.mp4 and LoadAudio
 * speech.flac, the placeholders of those workflows.
 * ImageToMask and ImageCompositeMasked (the edit's inpaint) come from the same ComfyUI on
 * 2026-10-22; LoadImage lists mask.png, the placeholder of the inpaint mask, and LoadAudio
 * voice.flac, the placeholder of the avatar's voice sample; start3.png is the third image of a
 * composed start photo (2026-10-22). ChatterboxVC (the voice change), first written from its pinned
 * source, matches the /object_info the GPU session of 2026-10-22 captured (tooltips removed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileAvatar, compileEdit, compileEffect, compileImageUpscale, compileHookEdit, compileHookTransition, compileJob, compileMusic, compileSpeech, compileTransition, compileUpscale, loadLibrary, type Aspect, type Library } from '@montagio/presets';
import { checkWorkflow, type ObjectInfo } from '../lib/comfy';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const info = JSON.parse(readFileSync(new URL('./fixtures/object_info-v0.41.0.json', import.meta.url), 'utf8')) as ObjectInfo;
const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1'];

let library: Library;
beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

test('every model template is accepted by ComfyUI v0.41.0 (object_info fixture)', () => {
  for (const model of library.models.values()) {
    expect({ model: model.id, problems: checkWorkflow(library.templates.get(model.workflow)!, info) }).toEqual({ model: model.id, problems: [] });
  }
});

test('every binding names an input its node declares', () => {
  for (const model of library.models.values()) {
    const workflow = library.templates.get(model.workflow)!;
    for (const [key, binding] of Object.entries(model.bindings)) {
      const node = workflow[binding.node];
      const spec = node && info[node.class_type]?.input;
      const declared = { ...spec?.required, ...spec?.optional };
      expect({ model: model.id, key, node: binding.node, class: node?.class_type, declared: binding.field in declared }).toEqual({
        model: model.id,
        key,
        node: binding.node,
        class: node?.class_type,
        declared: true,
      });
    }
  }
});

test('every preset compiles on its preferred and fallback models into a workflow ComfyUI v0.41.0 accepts', () => {
  let compiled = 0;
  for (const preset of library.presets.values()) {
    for (const id of [preset.models.preferred, preset.models.fallback].filter((id): id is string => Boolean(id))) {
      const model = library.models.get(id)!;
      for (const aspect of ASPECTS) {
        for (const resolution of model.limits.resolutions) {
          const { workflow } = compileJob(preset, model, library.templates.get(model.workflow)!, { imageRef: 'start.png', seed: 7, aspect, resolution });
          const problems = checkWorkflow(workflow, info);
          expect({ preset: preset.id, model: id, aspect, resolution, problems }).toEqual({ preset: preset.id, model: id, aspect, resolution, problems: [] });
          compiled++;
        }
      }
    }
  }
  expect(compiled).toBeGreaterThanOrEqual(12 * 2 * 3);
});

test('a combined preset needs Montagio Camera Embedding, which a stock ComfyUI does not have', () => {
  const preset = library.presets.get('rise-and-push')!;
  const model = library.models.get(preset.models.preferred)!;
  const { workflow } = compileJob(preset, model, library.templates.get(model.workflow)!, { imageRef: 'start.png', seed: 7, aspect: '16:9' });
  const { MontagioCameraEmbedding: _pack, ...stock } = info;
  expect(checkWorkflow(workflow, stock)).toEqual([expect.stringMatching(/class MontagioCameraEmbedding is not installed/)]);
});

test('the shipped workflows load no LoRA', () => {
  for (const [path, workflow] of library.templates) {
    expect({ path, loras: Object.values(workflow).filter((node) => /lora/i.test(node.class_type)) }).toEqual({ path, loras: [] });
  }
});

// The extension workflows (registry/extensions/), checked like the preset ones.

/** Whether `field` is an input its node's class declares; "resize_type.width" is an input of the option a dynamic combo selected. */
function declares(classType: string, field: string): boolean {
  const spec = info[classType]?.input;
  const declared: Record<string, unknown> = { ...spec?.required, ...spec?.optional };
  const [head, ...rest] = field.split('.');
  if (rest.length === 0) return head! in declared;
  const combo = declared[head!] as [string, { options?: { inputs?: { required?: object; optional?: object } }[] }] | undefined;
  return Boolean(combo?.[0] === 'COMFY_DYNAMICCOMBO_V3' && combo[1].options?.some((o) => rest[0]! in { ...o.inputs?.required, ...o.inputs?.optional }));
}

test('every extension template is accepted by ComfyUI v0.41.0', () => {
  expect(library.extensionModels.size).toBeGreaterThan(0);
  for (const model of library.extensionModels.values()) {
    const template = library.extensionTemplates.get(model.workflow)!;
    expect({ model: model.id, problems: checkWorkflow(template, info) }).toEqual({ model: model.id, problems: [] });
  }
});

test('every extension binding, and its output node, names what its node declares', () => {
  for (const model of library.extensionModels.values()) {
    const workflow = library.extensionTemplates.get(model.workflow)!;
    for (const [key, binding] of Object.entries(model.bindings)) {
      for (const target of Array.isArray(binding) ? binding : [binding]) {
        const node = workflow[target.node];
        expect({ model: model.id, key, ...target, declared: Boolean(node && declares(node.class_type, target.field)) }).toEqual({
          model: model.id,
          key,
          ...target,
          declared: true,
        });
      }
    }
    expect({ model: model.id, output: workflow[model.output.node]?.class_type }).toEqual({ model: model.id, output: expect.stringMatching(/^Save/) });
  }
});

test('the music job compiled for 5, 10 and 60 s is accepted', () => {
  const model = library.extensionModels.get('ace-step15-music')!;
  for (const duration_s of [5, 10, 60]) {
    const { workflow } = compileMusic(model, library.extensionTemplates.get(model.workflow)!, { prompt: 'calm piano', duration_s, seed: 3 });
    expect({ duration_s, problems: checkWorkflow(workflow, info) }).toEqual({ duration_s, problems: [] });
  }
});

test('the upscale job compiled for each aspect is accepted', () => {
  const model = library.extensionModels.get('seedvr2-upscale')!;
  for (const aspect of ASPECTS) {
    const { workflow } = compileUpscale(model, library.extensionTemplates.get(model.workflow)!, { videoRef: 'clip.mp4', aspect, seed: 3 });
    expect({ aspect, problems: checkWorkflow(workflow, info) }).toEqual({ aspect, problems: [] });
  }
});

test.each([
  ['Lightning', {}],
  ['40 steps', { fast: false }],
  ['a look', { look: 'action' as const }],
  ['a look, 40 steps', { look: 'infl8' as const, fast: false }],
  ['two images', { image2Ref: 'start2.png' }],
  ['an inpaint mask', { maskRef: 'mask.png' }],
  ['three images', { image2Ref: 'start2.png', image3Ref: 'start3.png' }],
])('the edit job is accepted: %s', (_, variant) => {
  const model = library.extensionModels.get('qwen-image-edit-2511')!;
  const inputs = { imageRef: 'start.png', instruction: 'make it night', seed: 3, ...variant };
  const { workflow } = compileEdit(model, library.extensionTemplates.get(model.workflow)!, inputs, library.lock);
  expect(checkWorkflow(workflow, info)).toEqual([]);
});

test.each(['16:9', '9:16', '1:1'] as Aspect[])('the HD photo job is accepted (%s)', (aspect) => {
  const model = library.extensionModels.get('seedvr2-image-upscale')!;
  const { workflow } = compileImageUpscale(model, library.extensionTemplates.get(model.workflow)!, { imageRef: 'start.png', aspect, seed: 3 });
  expect(checkWorkflow(workflow, info)).toEqual([]);
});

test.each([true, false])('every effect job is accepted, in every aspect (fast: %s)', (fast) => {
  const model = library.extensionModels.get('wan21-i2v-effects')!;
  const template = library.extensionTemplates.get(model.workflow)!;
  for (const effect of library.effects.values()) {
    for (const aspect of ASPECTS) {
      const { workflow } = compileEffect(effect, model, template, { imageRef: 'start.png', seed: 3, aspect, fast }, library.lock);
      expect({ effect: effect.id, aspect, problems: checkWorkflow(workflow, info) }).toEqual({ effect: effect.id, aspect, problems: [] });
    }
  }
});

test.each([true, false])('the transition job is accepted, in every aspect (fast: %s)', (fast) => {
  const model = library.extensionModels.get('wan22-flf2v-transition')!;
  for (const aspect of ASPECTS) {
    const { workflow } = compileTransition(model, library.extensionTemplates.get(model.workflow)!, { startRef: 'start.png', endRef: 'end.png', prompt: 'the camera pushes in', seed: 3, aspect, fast });
    expect({ aspect, problems: checkWorkflow(workflow, info) }).toEqual({ aspect, problems: [] });
  }
});

test('the two jobs of every hook are accepted', () => {
  const edit = library.extensionModels.get('qwen-image-edit-2511')!;
  const flf2v = library.extensionModels.get('wan22-flf2v-transition')!;
  for (const hook of library.hooks.values()) {
    const first = compileHookEdit(hook, edit, library.extensionTemplates.get(edit.workflow)!, { imageRef: 'start.png', image2Ref: 'start2.png', seed: 3 }, library.lock);
    const second = compileHookTransition(hook, flf2v, library.extensionTemplates.get(flf2v.workflow)!, { imageRef: 'start.png', endRef: 'end.png', seed: 3, aspect: '9:16' });
    expect({ hook: hook.id, edit: checkWorkflow(first.workflow, info), transition: checkWorkflow(second.workflow, info) }).toEqual({ hook: hook.id, edit: [], transition: [] });
  }
});

test('the voice job is accepted', () => {
  const model = library.extensionModels.get('chatterbox-mtl-voice')!;
  for (const language of ['en', 'fr'] as const) {
    const { workflow } = compileSpeech(model, library.extensionTemplates.get(model.workflow)!, { text: 'Hello there.', language, seed: 3 });
    expect({ language, problems: checkWorkflow(workflow, info) }).toEqual({ language, problems: [] });
    const cloned = compileSpeech(model, library.extensionTemplates.get(model.workflow)!, { text: 'Hello there.', language, seed: 3, voiceRef: 'voice.flac' });
    expect({ language, problems: checkWorkflow(cloned.workflow, info) }).toEqual({ language, problems: [] });
  }
});

test('the avatar job compiled for 1, 2 and 3 chunks is accepted', () => {
  const model = library.extensionModels.get('wan22-s2v-avatar')!;
  for (const audio_s of [3, 7, 15]) {
    const { workflow } = compileAvatar(model, library.extensionTemplates.get(model.workflow)!, {
      imageRef: 'start.png',
      audioRef: 'speech.flac',
      audio_s,
      aspect: '16:9',
      seed: 3,
    });
    expect({ audio_s, problems: checkWorkflow(workflow, info) }).toEqual({ audio_s, problems: [] });
  }
});

test('every class of the fixture comes from the core of ComfyUI or from the Montagio pack', () => {
  for (const [name, spec] of Object.entries(info)) {
    const origin =
      name === 'MontagioCameraEmbedding'
        ? 'custom_nodes.montagio'
        : name.startsWith('Chatterbox')
          ? 'custom_nodes.ComfyUI-Chatterbox'
          : /^(nodes|comfy_extras\.[a-z0-9_]+)$/;
    expect({ name, module: spec.python_module }).toEqual({ name, module: expect.stringMatching(origin) });
  }
});
