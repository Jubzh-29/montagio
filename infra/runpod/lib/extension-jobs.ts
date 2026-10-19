/**
 * The extension jobs of a GPU smoke test (smoke.ts --extension): each compiled by its
 * compiler of @montagio/presets, with the local files it uploads (the backend's `files`).
 */
import { basename } from 'node:path';
import {
  compileAvatar,
  compileEdit,
  compileMusic,
  compileSpeech,
  compileUpscale,
  type ApiWorkflow,
  type Aspect,
  type Library,
} from '@montagio/presets';
import type { ExtensionModel, ExtensionTask, OutputKind } from '@montagio/registry';

/** In the order a session runs them: the voice comes before the avatar that speaks it. */
export const EXTENSION_JOBS = ['music', 'upscale', 'edit', 'voice', 'avatar'] as const;
export type ExtensionJobName = (typeof EXTENSION_JOBS)[number];

const TASKS: Record<ExtensionJobName, ExtensionTask> = {
  music: 't2a',
  upscale: 'v2v-upscale',
  edit: 'i2i-edit',
  voice: 'tts',
  avatar: 'ia2v-talk',
};

const DEFAULT_TEXT: Record<'music' | 'edit' | 'voice', string> = {
  music: 'calm cinematic piano, slow strings',
  edit: 'make it a rainy night scene',
  voice: 'Hello, I am a Montagio avatar, rendered with open weights.',
};

export type ExtensionJobOptions = {
  jobs: readonly ExtensionJobName[];
  /** The photo of edit and avatar. */
  input?: string;
  /** The clip to upscale. */
  clip?: string;
  /** The speech of avatar, and its length in seconds (the caller reads it). */
  audio?: string;
  audio_s?: number;
  /** The music description, the edit instruction or the words to say; each job has a default. */
  text?: string;
  language: 'en' | 'fr';
  /** Music: the length of the film it goes under. */
  duration_s: number;
  seed: number;
  /** The aspect of the input (upscale target, avatar size). */
  aspect: Aspect;
};

export type ExtensionJob = {
  name: ExtensionJobName;
  model: ExtensionModel;
  workflow: ApiWorkflow;
  output: { kind: OutputKind; node: string };
  params: Record<string, unknown>;
  /** Local files the job uploads, as the backend's SubmitJob.files. */
  files: { node: string; field: string; path: string }[];
};

/** The node and input a model binds `key` to (the extension models bind files to one input). */
function fileInput(model: ExtensionModel, key: 'image' | 'video' | 'audio'): { node: string; field: string } {
  const binding = model.bindings[key];
  const target = Array.isArray(binding) ? binding[0] : binding;
  if (!target) throw new Error(`model ${model.id} has no ${key} binding`);
  return target;
}

function need(value: string | undefined, flag: string, job: ExtensionJobName): string {
  if (!value) throw new Error(`the ${job} job needs ${flag} <file>`);
  return value;
}

/** Compile the jobs asked for; a file a job needs and was not given fails before anything runs. */
export function extensionJobs(library: Library, opts: ExtensionJobOptions): ExtensionJob[] {
  return opts.jobs.map((name) => {
    const model = [...library.extensionModels.values()].find((m) => m.task === TASKS[name]);
    if (!model) throw new Error(`no extension model runs task ${TASKS[name]} (job ${name})`);
    const template = library.extensionTemplates.get(model.workflow)!;
    const text = (key: keyof typeof DEFAULT_TEXT) => opts.text?.trim() || DEFAULT_TEXT[key];
    const file = (key: 'image' | 'video' | 'audio', path: string) => ({ ...fileInput(model, key), path });
    switch (name) {
      case 'music': {
        const job = compileMusic(model, template, { prompt: text('music'), duration_s: opts.duration_s, seed: opts.seed });
        return { name, model, ...job, files: [] };
      }
      case 'upscale': {
        const clip = need(opts.clip, '--clip', name);
        const job = compileUpscale(model, template, { videoRef: basename(clip), aspect: opts.aspect, seed: opts.seed });
        return { name, model, ...job, files: [file('video', clip)] };
      }
      case 'edit': {
        const photo = need(opts.input, '--input', name);
        const job = compileEdit(model, template, { imageRef: basename(photo), instruction: text('edit'), seed: opts.seed }, library.lock);
        return { name, model, ...job, files: [file('image', photo)] };
      }
      case 'voice': {
        const job = compileSpeech(model, template, { text: text('voice'), language: opts.language, seed: opts.seed });
        return { name, model, ...job, files: [] };
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
        return { name, model, ...job, files: [file('image', photo), file('audio', audio)] };
      }
    }
  });
}
