import type { ExtensionBindingKey, ExtensionModel, ExtensionTask, LockEntry, OutputKind } from '@montagio/registry';
import { CompileError, type ApiWorkflow } from './compile';
import { dimensionsFor, type Aspect } from './dimensions';
import type { EditLook } from './schema';

export type { EditLook };

/**
 * Compilers of the extension jobs (music, upscale, image edit, voice, talking avatar).
 * Each one checks its inputs against the model's limits, then writes them into a copy
 * of the workflow template through the model's bindings, as compileJob does for presets.
 */

/** A compiled extension job: the workflow, the output node and kind the backend downloads, and what was written. */
export type ExtensionCompiled<P> = { workflow: ApiWorkflow; output: { kind: OutputKind; node: string }; params: P };

type Target = { node: string; field: string };
const targetsOf = (binding: Target | Target[]): Target[] => (Array.isArray(binding) ? binding : [binding]);

/**
 * Copy `template` and write each value into every input its binding names. A binding
 * whose node is not in the template is a CompileError, whether a value was given or not;
 * a bound key without a value keeps the template's.
 */
export function bindExtension(
  model: ExtensionModel,
  template: ApiWorkflow,
  values: Partial<Record<ExtensionBindingKey, unknown>>,
): ApiWorkflow {
  const workflow = structuredClone(template);
  const missing = new Map<string, ExtensionBindingKey[]>();
  for (const [key, binding] of Object.entries(model.bindings) as [ExtensionBindingKey, Target | Target[]][]) {
    for (const target of targetsOf(binding)) {
      const node = workflow[target.node];
      if (!node) {
        missing.set(target.node, [...(missing.get(target.node) ?? []), key]);
        continue;
      }
      if (values[key] !== undefined) node.inputs[target.field] = values[key];
    }
  }
  if (missing.size > 0) {
    const details = [...missing].map(([node, keys]) => `${keys.join(', ')} → node ${node}`).join('; ');
    throw new CompileError(`bindings not found in the workflow template of ${model.id}: ${details}`);
  }
  return workflow;
}

/** Every node in `ids` must be in the template: a compiler keeps, removes or rewires them by id. */
export function requireNodes(model: ExtensionModel, template: ApiWorkflow, ids: readonly string[]): void {
  const missing = ids.filter((id) => !template[id]);
  if (missing.length > 0) throw new CompileError(`the workflow template of ${model.id} has no node ${missing.join(', ')}`);
}

/** Remove node `id`, a pass-through on its `input` (a LoRA on `model`): what read its output reads that input. */
export function bypassNode(workflow: ApiWorkflow, id: string, input = 'model'): void {
  const upstream = workflow[id]!.inputs[input];
  for (const node of Object.values(workflow)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value[0] === id) node.inputs[field] = upstream;
    }
  }
  delete workflow[id];
}

/** Remove node `id` and every optional input that reads it. */
export function dropNode(workflow: ApiWorkflow, id: string): void {
  delete workflow[id];
  for (const node of Object.values(workflow)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value[0] === id) delete node.inputs[field];
    }
  }
}

function expectTask(model: ExtensionModel, task: ExtensionTask): void {
  if (model.task !== task) throw new CompileError(`model ${model.id} runs task ${model.task}, not ${task}`);
}

/** A user text, trimmed: never empty, never over the model's `max_chars`. */
function userText(value: string, label: string, model: ExtensionModel): string {
  const text = value.trim();
  if (!text) throw new CompileError(`the ${label} is empty`);
  const max = model.limits.max_chars;
  if (max !== undefined && text.length > max) throw new CompileError(`the ${label} has ${text.length} characters, over the ${max} of model ${model.id}`);
  return text;
}

const DEFAULT_BPM = 90;

export type MusicInputs = {
  /** The music asked for, in words ("tense synth pulse"). */
  prompt: string;
  /** The length of the film the music goes under, in seconds. */
  duration_s: number;
  seed: number;
  /** Tempo, 10 to 300 (90 by default). */
  bpm?: number;
};

/**
 * An instrumental soundtrack (ACE-Step 1.5). The music lasts the film rounded up to the
 * second, and at least the model's `min_duration_s` (ACE-Step documents 10 s and more):
 * the montage cuts it to the film with a fade.
 */
export function compileMusic(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: MusicInputs,
): ExtensionCompiled<{ prompt: string; duration_s: number; seed: number; bpm: number }> {
  expectTask(model, 't2a');
  let prompt = userText(inputs.prompt, 'music description', model);
  if (!/instrumental/i.test(prompt)) prompt = `${prompt}, instrumental`;
  if (!(inputs.duration_s > 0)) throw new CompileError(`a film of ${inputs.duration_s} s gets no music`);
  const duration_s = Math.max(model.limits.min_duration_s ?? 1, Math.ceil(inputs.duration_s));
  const max = model.limits.max_duration_s;
  if (max !== undefined && duration_s > max) {
    throw new CompileError(`a film of ${inputs.duration_s} s is longer than the ${max} s of music model ${model.id} makes`);
  }
  const bpm = inputs.bpm ?? DEFAULT_BPM;
  if (!Number.isInteger(bpm) || bpm < 10 || bpm > 300) throw new CompileError(`bpm ${bpm} is not a whole number from 10 to 300`);
  const workflow = bindExtension(model, template, { prompt, duration_s, seed: inputs.seed, bpm });
  return { workflow, output: { ...model.output }, params: { prompt, duration_s, seed: inputs.seed, bpm } };
}

/** The 1080p size of each aspect: a clip is never stretched to another shape. */
export const UPSCALE_TARGETS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export type UpscaleInputs = {
  /** The clip, as the backend's loader names it once uploaded. */
  videoRef: string;
  /** The aspect of the clip, which picks its 1080p size. */
  aspect: Aspect;
  seed: number;
  /** The clip's frame count, when known: over the model's `max_input_frames` it is refused. */
  frames?: number;
  /** Smooth motion: RIFE frames in between the restored ones, at twice the frame rate (16 to 32 fps for Wan). */
  smooth?: boolean;
};

/** The smooth pass puts one frame between two: twice the frame rate, the same length. */
export const SMOOTH_MULTIPLIER = 2;
/**
 * Nodes of workflows/seedvr2-upscale.api.json that compileUpscale keeps, removes or rewires: the
 * restored frames, the clip's frame rate, RIFE and its frame rate, and the video they make.
 */
const UPSCALE_NODES = { restored: '59', components: '74', interpolationModel: '101', interpolate: '102', fps: '103', video: '75' } as const;

/**
 * A finished clip to 1080p (SeedVR2): same aspect, frame rate and frame count, resized then restored.
 * Smooth, RIFE then adds a frame between each two (81 frames at 16 fps become 161 at 32 fps); without
 * it, the RIFE nodes are removed and the video takes the restored frames at the clip's frame rate.
 */
export function compileUpscale(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: UpscaleInputs,
): ExtensionCompiled<{ width: number; height: number; seed: number; smooth: boolean }> {
  expectTask(model, 'v2v-upscale');
  requireNodes(model, template, Object.values(UPSCALE_NODES));
  const max = model.limits.max_input_frames;
  if (inputs.frames !== undefined && max !== undefined && inputs.frames > max) {
    throw new CompileError(`a clip of ${inputs.frames} frames is longer than the ${max} frames model ${model.id} upscales`);
  }
  const target = Object.hasOwn(UPSCALE_TARGETS, inputs.aspect) ? UPSCALE_TARGETS[inputs.aspect] : undefined;
  if (!target) throw new CompileError(`aspect "${inputs.aspect}" has no 1080p size: 16:9, 9:16 or 1:1`);
  const { width, height } = target;
  const smooth = inputs.smooth ?? false;
  const workflow = bindExtension(model, template, { video: inputs.videoRef, width, height, seed: inputs.seed });
  if (smooth) {
    workflow[UPSCALE_NODES.interpolate]!.inputs.multiplier = SMOOTH_MULTIPLIER;
    workflow[UPSCALE_NODES.fps]!.inputs.expression = `a * ${SMOOTH_MULTIPLIER}`;
  } else {
    Object.assign(workflow[UPSCALE_NODES.video]!.inputs, { images: [UPSCALE_NODES.restored, 0], fps: [UPSCALE_NODES.components, 2] });
    for (const id of [UPSCALE_NODES.interpolate, UPSCALE_NODES.interpolationModel, UPSCALE_NODES.fps]) delete workflow[id];
  }
  return { workflow, output: { ...model.output }, params: { width, height, seed: inputs.seed, smooth } };
}

/** The HD size of a photo of each aspect: 2560 px on its long side, never stretched to another shape. */
export const IMAGE_UPSCALE_TARGETS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 2560, height: 1440 },
  '9:16': { width: 1440, height: 2560 },
  '1:1': { width: 2048, height: 2048 },
};

export type ImageUpscaleInputs = {
  /** The photo, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** The aspect of the photo, which picks its HD size. */
  aspect: Aspect;
  seed: number;
};

/** A photo to HD (SeedVR2 on one frame): same aspect, resized then restored. */
export function compileImageUpscale(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: ImageUpscaleInputs,
): ExtensionCompiled<{ width: number; height: number; seed: number }> {
  expectTask(model, 'i2i-upscale');
  const target = Object.hasOwn(IMAGE_UPSCALE_TARGETS, inputs.aspect) ? IMAGE_UPSCALE_TARGETS[inputs.aspect] : undefined;
  if (!target) throw new CompileError(`aspect "${inputs.aspect}" has no HD size: 16:9, 9:16 or 1:1`);
  const { width, height } = target;
  const workflow = bindExtension(model, template, { image: inputs.imageRef, width, height, seed: inputs.seed });
  return { workflow, output: { ...model.output }, params: { width, height, seed: inputs.seed } };
}

/** The looks of the edit: a LoRA of Qwen-Image-Edit-2511 (its lock entry) and the strength it runs at. */
export const EDIT_LOOKS = {
  /** systms INFL8: "inflate the <subject>". */
  infl8: { lock: 'systms-infl8-qwen-edit-2511', strength: 1 },
  /** systms ACTION: "action the <thing>", an action figure; the end frame of the figurine hook. */
  action: { lock: 'systms-action-qwen-edit-2511', strength: 1 },
  /** fal Multiple-Angles: "<sks> <azimuth> <elevation> <distance>"; its card advises 0.8 to 1, from 0.9. */
  angles: { lock: 'fal-multiple-angles-qwen-edit-2511', strength: 0.9 },
} as const satisfies Record<EditLook, { lock: string; strength: number }>;

/** Nodes of workflows/qwen-image-edit-2511.api.json that compileEdit keeps, removes or rewires. */
const EDIT_NODES = { look: '170', lightning: '171', image2: '42', image3: '43', sampler: '169', mask: '180', maskChannel: '181', composite: '182', save: '9' } as const;
/** With the 4-step Lightning LoRA, and without it (the template's values). */
const EDIT_SAMPLING = { fast: { steps: 4, cfg: 1 }, quality: { steps: 40, cfg: 4 } } as const;

export type EditInputs = {
  /** The photo to change, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** What to change, in words ("make it night"). */
  instruction: string;
  seed: number;
  /** The 4-step Lightning LoRA (default), or 40 steps without it. */
  fast?: boolean;
  look?: EditLook;
  /** A second image the instruction refers to ("wearing the outfit of image 2"). */
  image2Ref?: string;
  /** A third one (a composed start photo: a place, a character, a product). */
  image3Ref?: string;
  /** Inpaint: a mask painted over the photo, white where it changes; outside it the photo stays as it was. */
  maskRef?: string;
};

/**
 * The start photo changed by an instruction (Qwen-Image-Edit-2511); the negative encoder keeps
 * its empty prompt. The LoRA and image nodes a job does not use are removed, never loaded at
 * strength 0; `lock` gives the file of a look.
 */
export function compileEdit(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: EditInputs,
  lock: ReadonlyMap<string, LockEntry>,
): ExtensionCompiled<{ instruction: string; seed: number; fast: boolean; look: EditLook | null }> {
  expectTask(model, 'i2i-edit');
  requireNodes(model, template, Object.values(EDIT_NODES));
  const typed = userText(inputs.instruction, 'edit instruction', model);
  const look = inputs.look ?? null;
  // the Multiple-Angles LoRA reads its trigger first
  const instruction = look === 'angles' && !typed.startsWith('<sks>') ? `<sks> ${typed}` : typed;
  const fast = inputs.fast ?? true;
  const workflow = bindExtension(model, template, {
    image: inputs.imageRef,
    image2: inputs.image2Ref,
    image3: inputs.image3Ref,
    mask: inputs.maskRef,
    prompt: instruction,
    seed: inputs.seed,
  });
  if (look) {
    const entry = lock.get(EDIT_LOOKS[look].lock);
    if (!entry) throw new CompileError(`the ${look} look needs lock entry ${EDIT_LOOKS[look].lock}`);
    Object.assign(workflow[EDIT_NODES.look]!.inputs, { lora_name: entry.file, strength_model: EDIT_LOOKS[look].strength });
  } else {
    bypassNode(workflow, EDIT_NODES.look);
  }
  if (!fast) bypassNode(workflow, EDIT_NODES.lightning);
  Object.assign(workflow[EDIT_NODES.sampler]!.inputs, fast ? EDIT_SAMPLING.fast : EDIT_SAMPLING.quality);
  if (!inputs.image2Ref) dropNode(workflow, EDIT_NODES.image2);
  if (!inputs.image3Ref) dropNode(workflow, EDIT_NODES.image3);
  if (inputs.maskRef) {
    // the edited image pasted over the photo through the mask: what the saver writes
    workflow[EDIT_NODES.save]!.inputs.images = [EDIT_NODES.composite, 0];
  } else {
    for (const id of [EDIT_NODES.composite, EDIT_NODES.maskChannel, EDIT_NODES.mask]) dropNode(workflow, id);
  }
  return { workflow, output: { ...model.output }, params: { instruction, seed: inputs.seed, fast, look } };
}

/**
 * A composed start photo: a place, a character and a product (two of them at least), put
 * together by the edit in one coherent photo. The place comes first, as image 1: its frame
 * is the output's; then who, then what.
 */
export const COMPOSE_ROLES = ['location', 'character', 'product'] as const;
export type ComposeRole = (typeof COMPOSE_ROLES)[number];
export type ComposeRefs = Partial<Record<ComposeRole, string>>;

/** The instruction for the roles in image order. */
export function composeInstruction(order: readonly ComposeRole[]): string {
  const n = (role: ComposeRole) => `image ${order.indexOf(role) + 1}`;
  const has = (role: ComposeRole) => order.includes(role);
  const keep = [
    has('character') ? "the character's face, hair and outfit" : '',
    has('product') ? "the product's exact shape, colors and label" : '',
    has('location') ? "the place's look" : '',
  ].filter(Boolean);
  const keeps = `Keep ${keep.length > 1 ? `${keep.slice(0, -1).join(', ')} and ${keep.at(-1)}` : keep[0]}.`;
  let scene: string;
  if (has('character') && has('location')) {
    scene = `Show the character from ${n('character')} in the place of ${n('location')}${has('product') ? `, holding the product from ${n('product')}` : ''}.`;
  } else if (has('character')) {
    scene = `Show the character from ${n('character')} holding the product from ${n('product')}, in a simple setting.`;
  } else {
    scene = `Place the product from ${n('product')} in the place of ${n('location')}, as the hero of the shot.`;
  }
  const light = has('location') ? ' Light everything like the place.' : '';
  return `${scene} ${keeps}${light} Photorealistic, one coherent photo.`;
}

/** The start photo of an effect composed from two or three references; `order` says which file goes to image 1, 2, 3. */
export function compileCompose(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { refs: ComposeRefs; seed: number; fast?: boolean },
  lock: ReadonlyMap<string, LockEntry>,
): ExtensionCompiled<{ instruction: string; seed: number; fast: boolean; look: EditLook | null }> & { order: ComposeRole[] } {
  const order = COMPOSE_ROLES.filter((role) => Boolean(inputs.refs[role]));
  if (order.length < 2) throw new CompileError('a composed start photo needs two of a place, a character and a product');
  const [first, second, third] = order.map((role) => inputs.refs[role]!);
  const compiled = compileEdit(
    model,
    template,
    { imageRef: first!, image2Ref: second, ...(third ? { image3Ref: third } : {}), instruction: composeInstruction(order), seed: inputs.seed, fast: inputs.fast ?? true },
    lock,
  );
  return { ...compiled, order };
}

/**
 * The styles of a product ad: the scene the edit stages the product in, and the music ACE-Step
 * writes for it (always instrumental: an ad's words are its tagline).
 */
export const AD_STYLES = {
  studio: {
    scene: 'on a clean seamless studio backdrop with soft gradient light, a premium commercial look',
    music: 'minimal elegant electronic beat for a premium product commercial, instrumental, no vocals',
  },
  lifestyle: {
    scene: 'in a bright, natural everyday setting where it is used, warm natural light',
    music: 'warm upbeat acoustic pop for a feel-good commercial, instrumental, no vocals',
  },
  bold: {
    scene: 'on a vivid colorful background with bold graphic shapes and dramatic light, an energetic look',
    music: 'energetic punchy electronic track for a hype commercial, instrumental, no vocals',
  },
} as const;
export type AdStyle = keyof typeof AD_STYLES;

/** The edit's instruction for an ad: the product (image 1) in the style's scene, presented by a character (image 2) or not. */
export function adInstruction(style: AdStyle, withCharacter: boolean): string {
  const { scene } = AD_STYLES[style];
  const head = withCharacter
    ? `A professional advertising photo: the character from image 2 presents the product from image 1, ${scene}.`
    : `A professional advertising photo of the product from image 1, ${scene}.`;
  const keep = withCharacter
    ? "Keep the product's exact shape, colors, label and logo, and the character's face, hair and outfit."
    : "Keep the product's exact shape, colors, label and logo.";
  return `${head} ${keep} Leave clear space at the top of the frame. Photorealistic, one coherent photo.`;
}

/** A voice change: the speech of a clip (mono FLAC) said again in the voice of a sample. */
export function compileVoiceChange(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { audioRef: string; voiceRef: string },
): ExtensionCompiled<{ audioRef: string; voiceRef: string }> {
  expectTask(model, 'a2a-vc');
  if (!inputs.audioRef || !inputs.voiceRef) throw new CompileError('a voice change needs the speech and the voice sample');
  const workflow = bindExtension(model, template, { audio: inputs.audioRef, voice: inputs.voiceRef });
  return { workflow, output: { ...model.output }, params: { ...inputs } };
}

/**
 * The words of a speech (Whisper large-v3 turbo in the Montagio Transcribe Words node): the speech as
 * the app prepares it (mono FLAC, 16 kHz), and "auto" for Whisper to detect the language, or the code
 * of a language to impose. Which languages captions are made in is the app's rule, not the compiler's.
 */
export function compileTranscribe(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { audioRef: string; language: string },
): ExtensionCompiled<{ language: string }> {
  expectTask(model, 'a2t-words');
  if (!inputs.audioRef) throw new CompileError('a transcription needs the speech');
  if (inputs.language !== 'auto' && !/^[a-z]{2,3}$/.test(inputs.language)) throw new CompileError(`language "${inputs.language}" is not a language code`);
  const workflow = bindExtension(model, template, { audio: inputs.audioRef, language: inputs.language });
  return { workflow, output: { ...model.output }, params: { language: inputs.language } };
}

export type SpeechInputs = {
  /** What the avatar says. */
  text: string;
  language: 'en' | 'fr';
  seed: number;
  /** A voice sample to speak with, given with the speaker's consent; the built-in voice otherwise. */
  voiceRef?: string;
};

/** The node of workflows/chatterbox-mtl-voice.api.json that loads a voice sample. */
const SPEECH_VOICE_NODE = '4';

/**
 * Speech for the talking avatar (Chatterbox Multilingual V3), in its built-in voice, or in the
 * voice of a sample the caller gives with the speaker's consent (the app asks for it). Without
 * a sample the loader is removed: no reference clip, nothing left in the node's cache.
 * The built-in voice is English: for French, the model card's advice is cfg_weight 0,
 * so its accent does not carry over. Square brackets go (the node reads them as tags);
 * seed 0 means "random" to the node, so it is written as 1.
 */
export function compileSpeech(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: SpeechInputs,
): ExtensionCompiled<{ text: string; language: 'en' | 'fr'; seed: number; cfg: number }> {
  expectTask(model, 'tts');
  requireNodes(model, template, [SPEECH_VOICE_NODE]);
  if (inputs.language !== 'en' && inputs.language !== 'fr') throw new CompileError(`language "${inputs.language}" is not spoken here: en or fr`);
  const text = userText(inputs.text.replace(/[[\]]/g, ''), 'text to speak', model);
  const cfg = inputs.language === 'fr' ? 0 : 0.5;
  const seed = Math.max(1, inputs.seed);
  const workflow = bindExtension(model, template, { text, language: inputs.language, seed, cfg, audio: inputs.voiceRef });
  if (!inputs.voiceRef) dropNode(workflow, SPEECH_VOICE_NODE);
  return { workflow, output: { ...model.output }, params: { text, language: inputs.language, seed, cfg } };
}

/** The languages a speech is translated into: each one Chatterbox Multilingual V3 speaks. */
export const TRANSLATE_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'zh'] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

const LANGUAGE_NAME: Record<TranslateLanguage, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  zh: 'Mandarin Chinese, in simplified characters',
};

/** What Gemma 4 is asked once it has transcribed the speech: the translation of that text alone, short enough to say. */
export function translateInstruction(language: TranslateLanguage): string {
  const name = LANGUAGE_NAME[language];
  return `Translate the following text into ${name}. Only output the ${name} translation: one plain paragraph, natural and concise, without quotes, labels or notes. The text:`;
}

/**
 * Translate a speech (Gemma 4 E4B with the core TextGenerate node: it transcribes, then translates
 * the transcription in a second pass), then say the translation in the
 * same voice (Chatterbox Multilingual V3, the speech as its reference). cfg_weight is 0, the model
 * card's advice when the reference voice speaks another language than the text.
 */
export function compileTranslate(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: { audioRef: string; language: TranslateLanguage; seed: number },
): ExtensionCompiled<{ language: TranslateLanguage; instruction: string; seed: number; cfg: number }> {
  expectTask(model, 'a2a-translate');
  if (!inputs.audioRef) throw new CompileError('a translation needs the speech');
  if (!(TRANSLATE_LANGUAGES as readonly string[]).includes(inputs.language)) {
    throw new CompileError(`language "${inputs.language}" is not one of ${TRANSLATE_LANGUAGES.join(', ')}`);
  }
  const instruction = translateInstruction(inputs.language);
  const seed = Math.max(1, inputs.seed);
  const workflow = bindExtension(model, template, { audio: inputs.audioRef, prompt: instruction, language: inputs.language, cfg: 0, seed });
  return { workflow, output: { ...model.output }, params: { language: inputs.language, instruction, seed, cfg: 0 } };
}

/** The prompt of an avatar job without one: S2V tends to move the camera and the body unless told not to. */
export const AVATAR_DEFAULT_PROMPT = 'a person talking to the camera, medium close-up, static camera';

/** Video frames per second of Wan 2.2 S2V, and the frames each chunk adds (5 s of audio). */
const S2V_FPS = 16;
const S2V_CHUNK_FRAMES = 80;
/** The nodes of the two extension chunks of workflows/wan22-s2v-avatar.api.json: Extend, KSampler, LatentConcat. */
const S2V_EXTENSIONS = [
  { extend: '79076', sampler: '79077', concat: '79078' },
  { extend: '85076', sampler: '85077', concat: '85078' },
] as const;

export type AvatarInputs = {
  /** The photo of the person, as the backend's loader names it once uploaded. */
  imageRef: string;
  /** The speech (the voice job's FLAC, or any audio), as the loader names it. */
  audioRef: string;
  /** The length of the speech in seconds, read by the caller (probeAudio of @montagio/sequence). */
  audio_s: number;
  aspect: Aspect;
  seed: number;
  /** What the scene looks like; empty gives the talking-head prompt. */
  prompt?: string;
};

/**
 * A photo speaking a speech file (Wan 2.2 S2V), at 480p and 16 fps. Each chunk renders 77
 * frames and adds 80 to the video (5 s of audio); a longer speech takes up to 3 chunks,
 * the extensions reading the accumulated latent so their audio window moves on. The unused
 * chunks are removed, and the decoded frames are cut to the speech: ceil(16 × seconds),
 * at most 80 × chunks − 3 (the last 0.19 s of exactly 5, 10 or 15 s is lost).
 */
export function compileAvatar(
  model: ExtensionModel,
  template: ApiWorkflow,
  inputs: AvatarInputs,
): ExtensionCompiled<{ width: number; height: number; frames: number; chunks: 1 | 2 | 3; seed: number; prompt: string }> {
  expectTask(model, 'ia2v-talk');
  const min = model.limits.min_duration_s ?? 0;
  const max = model.limits.max_duration_s ?? Infinity;
  if (!(inputs.audio_s >= min && inputs.audio_s <= max)) {
    throw new CompileError(`speech of ${inputs.audio_s} s is outside the ${min} to ${max} s model ${model.id} animates`);
  }
  const prompt = inputs.prompt?.trim() ? userText(inputs.prompt, 'avatar prompt', model) : AVATAR_DEFAULT_PROMPT;
  const { width, height } = dimensionsFor(inputs.aspect, '480p');
  const wanted = Math.ceil(S2V_FPS * inputs.audio_s);
  const chunks = Math.max(1, Math.ceil(wanted / S2V_CHUNK_FRAMES));
  if (chunks > S2V_EXTENSIONS.length + 1) throw new CompileError(`speech of ${inputs.audio_s} s needs ${chunks} chunks, model ${model.id} renders 3 at most`);
  const frames = Math.min(wanted, S2V_CHUNK_FRAMES * chunks - 3);
  const workflow = bindExtension(model, template, {
    image: inputs.imageRef,
    audio: inputs.audioRef,
    prompt,
    seed: inputs.seed,
    width,
    height,
    frames,
  });
  for (const ids of S2V_EXTENSIONS) {
    for (const id of Object.values(ids)) if (!workflow[id]) throw new CompileError(`node ${id} of the chunk rule is not in the workflow template of ${model.id}`);
  }
  S2V_EXTENSIONS.forEach((ids, i) => {
    if (i + 2 > chunks) for (const id of Object.values(ids)) delete workflow[id];
    else workflow[ids.sampler]!.inputs.seed = inputs.seed + i + 1;
  });
  // The first-frame fix (LatentCut + LatentConcat) and the decode read the last chunk kept.
  const last = chunks === 1 ? '3' : S2V_EXTENSIONS[chunks - 2]!.concat;
  workflow['94']!.inputs.samples = [last, 0];
  workflow['95']!.inputs.samples2 = [last, 0];
  return { workflow, output: { ...model.output }, params: { width, height, frames, chunks: chunks as 1 | 2 | 3, seed: inputs.seed, prompt } };
}
