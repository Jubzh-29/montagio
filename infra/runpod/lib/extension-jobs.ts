/**
 * The extension jobs of a GPU smoke test (smoke.ts --extension): each compiled by its
 * compiler of @montagio/presets, with the local files it uploads (the backend's `files`).
 */
import { basename } from 'node:path';
import {
  compileAvatar,
  compileEdit,
  compileEffect,
  compileHookEdit,
  compileHookTransition,
  compileMusic,
  compileSpeech,
  compileUpscale,
  EDIT_LOOK_IDS,
  type ApiWorkflow,
  type Aspect,
  type Library,
} from '@montagio/presets';
import type { ExtensionBindingKey, ExtensionModel, ExtensionTask, OutputKind } from '@montagio/registry';

/**
 * In the order a session runs them, the priority order of 2026-10-19: a hook's edit comes
 * before its transition, the voice before the avatar that speaks it.
 */
export const EXTENSION_JOBS = ['edit', 'effect', 'hook-edit', 'transition', 'voice', 'avatar', 'music', 'upscale'] as const;
export type ExtensionJobName = (typeof EXTENSION_JOBS)[number];

const TASKS: Record<ExtensionJobName, ExtensionTask> = {
  edit: 'i2i-edit',
  effect: 'i2v-effect',
  'hook-edit': 'i2i-edit',
  transition: 'flf2v',
  voice: 'tts',
  avatar: 'ia2v-talk',
  music: 't2a',
  upscale: 'v2v-upscale',
};

const DEFAULT_TEXT: Record<'music' | 'edit' | 'voice', string> = {
  music: 'calm cinematic piano, slow strings',
  edit: 'make it a rainy night scene',
  voice: 'Hello, I am a Montagio avatar, rendered with open weights.',
};

/** The hook of the GPU session S2 when none is named. */
export const DEFAULT_HOOK = 'eyes-in';

export type ExtensionJobOptions = {
  jobs: readonly ExtensionJobName[];
  /** The photo of edit, effect, hook and avatar. */
  input?: string;
  /** The second image of a two-reference hook (the outfit of outfit-morph). */
  input2?: string;
  /** The end frame of a transition run on its own (a hook's edit output otherwise). */
  end?: string;
  /** The clip to upscale, with its aspect and frame count (the caller probes it): its own, never the photo's. */
  clip?: string;
  clipAspect?: Aspect;
  clipFrames?: number;
  /** The speech of avatar, and its length in seconds (the caller reads it). */
  audio?: string;
  audio_s?: number;
  /** The music description, the edit instruction, the effect's subject or the words to say; each job has a default. */
  text?: string;
  language: 'en' | 'fr';
  /** Music: the length of the film it goes under. */
  duration_s: number;
  seed: number;
  /** The aspect of the photo (effect, transition and avatar size). */
  aspect: Aspect;
  /** The effect presets to run (every one when absent). */
  effects?: readonly string[];
  /** The hook of hook-edit and transition (eyes-in when absent). */
  hook?: string;
  /** The 4-step LoRAs of the edit, the effects and the transition (default), or their quality path. */
  fast?: boolean;
  /** A look of the edit job (infl8, action, angles), so that a GPU session validates each one. */
  look?: string;
};

export type ExtensionJob = {
  name: ExtensionJobName;
  /** The name, and the effect or hook it runs: "effect:squish", "transition:eyes-in". */
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

/** Compile the jobs asked for; a file a job needs and was not given fails before anything runs. */
export function extensionJobs(library: Library, opts: ExtensionJobOptions): ExtensionJob[] {
  return opts.jobs.flatMap((name): ExtensionJob[] => {
    const model = [...library.extensionModels.values()].find((m) => m.task === TASKS[name]);
    if (!model) throw new Error(`no extension model runs task ${TASKS[name]} (job ${name})`);
    const template = library.extensionTemplates.get(model.workflow)!;
    const text = (key: keyof typeof DEFAULT_TEXT) => opts.text?.trim() || DEFAULT_TEXT[key];
    const file = (key: ExtensionBindingKey, path: string) => ({ ...fileInput(model, key), path });
    const fast = opts.fast ?? true;
    switch (name) {
      case 'edit': {
        const photo = need(opts.input, '--input', name);
        const look = opts.look === undefined ? undefined : EDIT_LOOK_IDS.find((id) => id === opts.look);
        if (opts.look !== undefined && !look) throw new Error(`unknown look "${opts.look}" (known: ${EDIT_LOOK_IDS.join(', ')})`);
        const job = compileEdit(model, template, { imageRef: basename(photo), instruction: text('edit'), seed: opts.seed, fast, ...(look ? { look } : {}) }, library.lock);
        return [{ name, tag: name, model, ...job, files: [file('image', photo)] }];
      }
      case 'effect': {
        const photo = need(opts.input, '--input', name);
        return (opts.effects ?? [...library.effects.keys()]).map((id) => {
          const effect = known(library.effects, id, 'effect');
          const effectModel = known(library.extensionModels, effect.models.preferred, 'effect model');
          const inputs = { imageRef: basename(photo), seed: opts.seed, aspect: opts.aspect, fast, ...(opts.text?.trim() ? { subject: opts.text } : {}) };
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
        const job = compileSpeech(model, template, { text: text('voice'), language: opts.language, seed: opts.seed });
        return [{ name, tag: name, model, ...job, files: [] }];
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
      case 'upscale': {
        const clip = need(opts.clip, '--clip', name);
        if (opts.clipAspect === undefined || opts.clipFrames === undefined) throw new Error('the upscale job needs the aspect and the frame count of its clip');
        const job = compileUpscale(model, template, { videoRef: basename(clip), aspect: opts.clipAspect, frames: opts.clipFrames, seed: opts.seed });
        return [{ name, tag: name, model, ...job, files: [file('video', clip)] }];
      }
    }
  });
}
