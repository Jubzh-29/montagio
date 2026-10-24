/**
 * The extension jobs of a GPU smoke test (smoke.ts --extension): each compiled by its
 * compiler of @montagio/presets, with the local files it uploads (the backend's `files`).
 */
import { basename } from 'node:path';
import {
  compileAvatar,
  compileCompose,
  compileEdit,
  compileEffect,
  compileHookEdit,
  compileHookTransition,
  compileMotion,
  compileMusic,
  compileRestyle,
  compileSpeech,
  compileImageUpscale,
  compileUpscale,
  compileVoiceChange,
  EDIT_LOOK_IDS,
  restyleInstruction,
  type ApiWorkflow,
  type Aspect,
  type Library,
  type RestyleReference,
} from '@montagio/presets';
import type { ExtensionBindingKey, ExtensionModel, ExtensionTask, OutputKind } from '@montagio/registry';

/**
 * In the order a session runs them, the priority order of 2026-10-19 (the motion transfer,
 * added on 2026-10-20, then the restyle on 2026-10-24, last): a hook's edit comes before its
 * transition, the voice before the avatar that speaks it, a composed photo before the effects
 * that animate it, the restyled first frame before the restyle that keeps it.
 */
export const EXTENSION_JOBS = [
  'edit',
  'compose',
  'effect',
  'hook-edit',
  'transition',
  'voice',
  'avatar',
  'music',
  'upscale',
  'upscale-image',
  'voice-change',
  'motion',
  'restyle-edit',
  'restyle',
] as const;
export type ExtensionJobName = (typeof EXTENSION_JOBS)[number];

const TASKS: Record<ExtensionJobName, ExtensionTask> = {
  edit: 'i2i-edit',
  compose: 'i2i-edit',
  effect: 'i2v-effect',
  'hook-edit': 'i2i-edit',
  transition: 'flf2v',
  voice: 'tts',
  avatar: 'ia2v-talk',
  music: 't2a',
  upscale: 'v2v-upscale',
  'upscale-image': 'i2i-upscale',
  'voice-change': 'a2a-vc',
  motion: 'motion-transfer',
  'restyle-edit': 'i2i-edit',
  restyle: 'v2v-restyle',
};

/**
 * The jobs that read a text: the edit instruction, the effects' subject, the words to say, the
 * music description, the motion's description, the restyle's new look (its edit reads it too).
 */
export const TEXT_JOBS = ['edit', 'effect', 'voice', 'music', 'motion', 'restyle'] as const satisfies readonly ExtensionJobName[];
export type TextJobName = (typeof TEXT_JOBS)[number];

const DEFAULT_TEXT: Record<'music' | 'edit' | 'voice' | 'restyle', string> = {
  music: 'calm cinematic piano, slow strings',
  edit: 'make it a rainy night scene',
  voice: 'Hello, I am a Montagio avatar, rendered with open weights.',
  restyle: 'a snowy winter evening',
};

/** The hook of the GPU session S2 when none is named. */
export const DEFAULT_HOOK = 'iris-dive';

export type ExtensionJobOptions = {
  jobs: readonly ExtensionJobName[];
  /** The photo of edit, effect, hook and avatar; the place of a composition. */
  input?: string;
  /** The second image of a two-reference hook (the outfit of wardrobe-swap), or the character of a composition. */
  input2?: string;
  /** The product of a composition (optional: a place and a character are enough). */
  input3?: string;
  /** The outfit of a composed character (the Motion tab's): with it, the place is left out. */
  outfit?: string;
  /** A composition for a motion transfer: the character seen full body. */
  composeFullBody?: boolean;
  /** The edit's inpaint mask (white where the photo changes). */
  mask?: string;
  /** The end frame of a transition run on its own (a hook's edit output otherwise). */
  end?: string;
  /** The clip to upscale, with its aspect and frame count (the caller probes it): its own, never the photo's. */
  clip?: string;
  clipAspect?: Aspect;
  clipFrames?: number;
  /** Upscale: RIFE frames in between, at twice the clip's frame rate (the HD pass's smooth option). */
  smooth?: boolean;
  /** The reference clip of the motion transfer, or the clip of a restyle, prepared by prepareMotionClip, with its length and aspect. */
  motion?: string;
  motion_s?: number;
  motionAspect?: Aspect;
  /** The restyled clip's first frame, which restyle-edit changes. */
  restyleFrame?: string;
  /** The restyle's reference image and what it is to the job; none: the text alone. */
  restyleReference?: { path: string; mode: RestyleReference };
  /** The speech of avatar, and its length in seconds (the caller reads it). */
  audio?: string;
  /** The voice job's sample (mono FLAC, as the app prepares it): the cloned voice. */
  voice?: string;
  audio_s?: number;
  /** The text of each job that reads one, read by that job only; a job given none keeps its default. */
  text?: Partial<Record<TextJobName, string>>;
  language: 'en' | 'fr';
  /** Music: the length of the film it goes under. */
  duration_s: number;
  seed: number;
  /** The aspect of the photo (effect, transition and avatar size). */
  aspect: Aspect;
  /** The effect presets to run (every one when absent). */
  effects?: readonly string[];
  /** The hook of hook-edit and transition (iris-dive when absent). */
  hook?: string;
  /** The 4-step LoRAs of the edit, the effects and the transition (default), or their quality path. */
  fast?: boolean;
  /** A look of the edit job (infl8, action, angles), so that a GPU session validates each one. */
  look?: string;
};

export type ExtensionJob = {
  name: ExtensionJobName;
  /** The name, and the effect or hook it runs: "effect:squish", "transition:iris-dive". */
  tag: string;
  model: ExtensionModel;
  workflow: ApiWorkflow;
  output: { kind: OutputKind; node: string };
  params: Record<string, unknown>;
  /** Local files the job uploads, as the backend's SubmitJob.files. */
  files: { node: string; field: string; path: string }[];
};

/** The node and input a model binds `key` to (the extension models bind files to one input). */
function fileInput(model: ExtensionModel, key: ExtensionBindingKey): { node: string; field: string } {
  const binding = model.bindings[key];
  const target = Array.isArray(binding) ? binding[0] : binding;
  if (!target) throw new Error(`model ${model.id} has no ${key} binding`);
  return target;
}

function need(value: string | undefined, flag: string, job: ExtensionJobName): string {
  if (!value) throw new Error(`the ${job} job needs ${flag} <file>`);
  return value;
}

function known<T>(map: Map<string, T>, id: string, what: string): T {
  const value = map.get(id);
  if (!value) throw new Error(`unknown ${what} "${id}" (known: ${[...map.keys()].join(', ')})`);
  return value;
}

/**
 * The texts of smoke --text, each for one job of the run: "music=calm piano" names its job, a
 * bare text goes to the one job of the run that reads a text. A bare text is refused when
 * several do, since it would feed them all (the edit instruction becoming the effects' subject).
 */
export function jobTexts(values: readonly string[], jobs: readonly ExtensionJobName[]): Partial<Record<TextJobName, string>> {
  const readers = TEXT_JOBS.filter((job) => jobs.includes(job));
  const texts: Partial<Record<TextJobName, string>> = {};
  for (const value of values) {
    const named = TEXT_JOBS.find((job) => value.startsWith(`${job}=`));
    if (named && !readers.includes(named)) throw new Error(`--text ${named}=…: the ${named} job is not part of this run`);
    if (!named && readers.length === 0) throw new Error(`--text "${value}": no job of this run reads a text`);
    if (!named && readers.length > 1) throw new Error(`--text "${value}": ${readers.join(', ')} read a text: name the job, as in --text ${readers[0]}="${value}"`);
    const job = named ?? readers[0]!;
    if (texts[job] !== undefined) throw new Error(`--text: two texts for the ${job} job`);
    texts[job] = named ? value.slice(named.length + 1) : value;
  }
  return texts;
}

/** Compile the jobs asked for; a file a job needs and was not given fails before anything runs. */
export function extensionJobs(library: Library, opts: ExtensionJobOptions): ExtensionJob[] {
  return opts.jobs.flatMap((name): ExtensionJob[] => {
    const model = [...library.extensionModels.values()].find((m) => m.task === TASKS[name]);
    if (!model) throw new Error(`no extension model runs task ${TASKS[name]} (job ${name})`);
    const template = library.extensionTemplates.get(model.workflow)!;
    const text = (key: keyof typeof DEFAULT_TEXT) => opts.text?.[key]?.trim() || DEFAULT_TEXT[key];
    const file = (key: ExtensionBindingKey, path: string) => ({ ...fileInput(model, key), path });
    const fast = opts.fast ?? true;
    switch (name) {
      case 'edit': {
        const photo = need(opts.input, '--input', name);
        const look = opts.look === undefined ? undefined : EDIT_LOOK_IDS.find((id) => id === opts.look);
        if (opts.look !== undefined && !look) throw new Error(`unknown look "${opts.look}" (known: ${EDIT_LOOK_IDS.join(', ')})`);
        const mask = opts.mask;
        const job = compileEdit(
          model,
          template,
          { imageRef: basename(photo), instruction: text('edit'), seed: opts.seed, fast, ...(look ? { look } : {}), ...(mask ? { maskRef: basename(mask) } : {}) },
          library.lock,
        );
        return [{ name, tag: mask ? `${name}:inpaint` : name, model, ...job, files: [file('image', photo), ...(mask ? [file('mask', mask)] : [])] }];
      }
      case 'compose': {
        // The Studio's composed photo: a place, a character and a product (an effect's start photo), or a
        // character, its outfit and a product (the Motion tab's character), each in that image order.
        const outfit = opts.outfit;
        const place = outfit ? undefined : need(opts.input, '--input', name);
        const character = need(opts.input2, '--input2', name);
        const product = opts.input3;
        const paths = { location: place, character, outfit, product };
        const refs = Object.fromEntries(Object.entries(paths).flatMap(([role, path]) => (path ? [[role, basename(path)]] : [])));
        const { order, ...job } = compileCompose(model, template, { refs, seed: opts.seed, fast, fullBody: opts.composeFullBody ?? false }, library.lock);
        const keys = ['image', 'image2', 'image3'] as const;
        return [{ name, tag: `${name}:${order.length}refs`, model, ...job, files: order.map((role, index) => file(keys[index]!, paths[role]!)) }];
      }
      case 'effect': {
        const photo = need(opts.input, '--input', name);
        return (opts.effects ?? [...library.effects.keys()]).map((id) => {
          const effect = known(library.effects, id, 'effect');
          const effectModel = known(library.extensionModels, effect.models.preferred, 'effect model');
          const subject = opts.text?.effect?.trim();
          const inputs = { imageRef: basename(photo), seed: opts.seed, aspect: opts.aspect, fast, ...(subject ? { subject } : {}) };
          const job = compileEffect(effect, effectModel, library.extensionTemplates.get(effectModel.workflow)!, inputs, library.lock);
          return { name, tag: `${name}:${id}`, model: effectModel, ...job, files: [{ ...fileInput(effectModel, 'image'), path: photo }] };
        });
      }
      case 'hook-edit': {
        const hook = known(library.hooks, opts.hook ?? DEFAULT_HOOK, 'hook');
        const photo = need(opts.input, '--input', name);
        const second = hook.end_frame.references === 2 ? opts.input2 : undefined;
        const job = compileHookEdit(hook, model, template, { imageRef: basename(photo), ...(second ? { image2Ref: basename(second) } : {}), seed: opts.seed, fast }, library.lock);
        return [{ name, tag: `${name}:${hook.id}`, model, ...job, files: [file('image', photo), ...(second ? [file('image2', second)] : [])] }];
      }
      case 'transition': {
        const hook = known(library.hooks, opts.hook ?? DEFAULT_HOOK, 'hook');
        const photo = need(opts.input, '--input', name);
        const end = need(opts.end, '--end', name);
        const job = compileHookTransition(hook, model, template, { imageRef: basename(photo), endRef: basename(end), seed: opts.seed, aspect: opts.aspect, fast });
        return [{ name, tag: `${name}:${hook.id}`, model, ...job, files: [file('image', photo), file('end_image', end)] }];
      }
      case 'voice': {
        const sample = opts.voice;
        const job = compileSpeech(model, template, { text: text('voice'), language: opts.language, seed: opts.seed, ...(sample ? { voiceRef: basename(sample) } : {}) });
        return [{ name, tag: sample ? `${name}:cloned` : name, model, ...job, files: sample ? [file('audio', sample)] : [] }];
      }
      case 'avatar': {
        const photo = need(opts.input, '--input', name);
        const audio = need(opts.audio, '--audio', name);
        if (opts.audio_s === undefined) throw new Error('the avatar job needs the length of its speech');
        const job = compileAvatar(model, template, {
          imageRef: basename(photo),
          audioRef: basename(audio),
          audio_s: opts.audio_s,
          aspect: opts.aspect,
          seed: opts.seed,
        });
        return [{ name, tag: name, model, ...job, files: [file('image', photo), file('audio', audio)] }];
      }
      case 'music': {
        const job = compileMusic(model, template, { prompt: text('music'), duration_s: opts.duration_s, seed: opts.seed });
        return [{ name, tag: name, model, ...job, files: [] }];
      }
      case 'motion': {
        const photo = need(opts.input, '--input', name);
        const clip = need(opts.motion, '--motion', name);
        if (opts.motion_s === undefined || opts.motionAspect === undefined) throw new Error('the motion job needs the length and the aspect of its prepared clip');
        const motion = opts.text?.motion?.trim();
        const job = compileMotion(model, template, {
          imageRef: basename(photo),
          videoRef: basename(clip),
          video_s: opts.motion_s,
          aspect: opts.motionAspect,
          seed: opts.seed,
          ...(motion ? { motion } : {}),
        });
        return [{ name, tag: name, model, ...job, files: [file('image', photo), file('video', clip)] }];
      }
      case 'restyle-edit': {
        // The clip's first frame restyled by the edit: the reference a restyle keeps as its first frame.
        const frame = need(opts.restyleFrame, '--motion', name);
        const job = compileEdit(model, template, { imageRef: basename(frame), instruction: restyleInstruction(text('restyle')), seed: opts.seed, fast }, library.lock);
        return [{ name, tag: name, model, ...job, files: [file('image', frame)] }];
      }
      case 'restyle': {
        const clip = need(opts.motion, '--motion', name);
        if (opts.motion_s === undefined || opts.motionAspect === undefined) throw new Error('the restyle job needs the length and the aspect of its prepared clip');
        const reference = opts.restyleReference;
        const job = compileRestyle(model, template, {
          videoRef: basename(clip),
          video_s: opts.motion_s,
          aspect: opts.motionAspect,
          seed: opts.seed,
          prompt: text('restyle'),
          ...(reference ? { reference: { imageRef: basename(reference.path), mode: reference.mode } } : {}),
        });
        return [{ name, tag: reference ? `${name}:${reference.mode}` : name, model, ...job, files: [file('video', clip), ...(reference ? [file('image', reference.path)] : [])] }];
      }
      case 'upscale': {
        const clip = need(opts.clip, '--clip', name);
        if (opts.clipAspect === undefined || opts.clipFrames === undefined) throw new Error('the upscale job needs the aspect and the frame count of its clip');
        const job = compileUpscale(model, template, {
          videoRef: basename(clip),
          aspect: opts.clipAspect,
          frames: opts.clipFrames,
          seed: opts.seed,
          smooth: opts.smooth ?? false,
        });
        return [{ name, tag: name, model, ...job, files: [file('video', clip)] }];
      }
      case 'voice-change': {
        const speech = need(opts.audio, '--audio', name);
        const sample = need(opts.voice, '--voice', name);
        const job = compileVoiceChange(model, template, { audioRef: basename(speech), voiceRef: basename(sample) });
        return [{ name, tag: name, model, ...job, files: [file('audio', speech), file('voice', sample)] }];
      }
      case 'upscale-image': {
        const photo = need(opts.input, '--input', name);
        const job = compileImageUpscale(model, template, { imageRef: basename(photo), aspect: opts.aspect ?? '16:9', seed: opts.seed });
        return [{ name, tag: name, model, ...job, files: [file('image', photo)] }];
      }
    }
  });
}

/** The photo a job reads (the file bound to its model's `image` input), or null for a job without one (voice, music, upscale). */
export function photoFile(job: ExtensionJob): string | null {
  const binding = job.model.bindings.image;
  const target = Array.isArray(binding) ? binding[0] : binding;
  if (!target) return null;
  return job.files.find((file) => file.node === target.node && file.field === target.field)?.path ?? null;
}
