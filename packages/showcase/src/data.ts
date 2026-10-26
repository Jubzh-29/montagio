// Types only: the web app imports them in the browser (`@montagio/showcase/data`).
import type { OpenStackReport } from '@montagio/check-open-stack';
import type { ApiWorkflow, Aspect } from '@montagio/presets';
import type { LockEntry, ModelEntry } from '@montagio/registry';

/** The model that restored a rendered file to 1080p (its HD pass, SeedVR2), named as the caption shows it. */
export type ShowcaseHdModel = { id: string; name: string; license: string };

/** An effect or a hook of the showcase, with the sample photos it was rendered on. */
export type ShowcaseExampleItem = {
  id: string;
  name: string;
  description: string;
  modelId: string;
  modelName: string;
  license: string;
  /** `poster`: the clip's first frame, shown while it loads (absent in data written before it); `hd`: its HD pass. */
  examples: { sample: string; url: string; workflowUrl: string; poster?: string; hd?: ShowcaseHdModel }[];
};

/** A model a feature example ran, as its caption names it and Open Stack lists it. */
export type ShowcaseModel = { id: string; name: string; license: string };

/**
 * A feature example of the showcase (avatar, translation, captions, motion, Restyle, object swap, trend
 * remix): the clip, what it started from, and each job of its chain with the workflow it ran.
 */
export type ShowcaseFeatureExample = {
  id: string;
  feature: 'avatar' | 'translate' | 'captions' | 'motion' | 'restyle' | 'swap' | 'remix';
  aspect: '16:9' | '9:16';
  url: string;
  poster: string;
  /** It speaks: the page plays it with its sound. */
  audio: boolean;
  text?: string;
  language?: string;
  face?: string;
  from?: string;
  style?: string;
  post?: { caption: string; hashtags: string[] };
  inputs: { role: 'photo' | 'clip' | 'frame'; url: string }[];
  steps: { model: ShowcaseModel; workflowUrl: string }[];
  /** Its 1080p pass: the upscaler, the frame rate it ends at, and its workflow. */
  hd?: ShowcaseHdModel & { fps: number; workflowUrl: string };
};

/**
 * Everything the static showcase needs, written by `showcase prepare` to
 * public/showcase/data.json. URLs are relative to the showcase folder
 * ("clips/…"); the page prefixes them with its base path.
 */
export type ShowcaseData = {
  schema: 'montagio/showcase-data@0.1';
  builtAt: string;
  /** The public repository (source code link, AGPL-3.0 §13, and "run it yourself"). */
  repoUrl: string | null;
  /** The model every rendered clip was made with. */
  model: { id: string; name: string; license: string };
  /** `preview` is a light loop of the preset on the first sample, for the gallery tile; `poster` its first frame. */
  presets: { id: string; name: string; description: string; poses: string[]; speed: number; defaultModel: string; preview: string; poster?: string; yaml: string }[];
  models: { id: string; name: string; kind: 'video' | 'image'; tier: 'quality' | 'turbo' | 'fast'; license: string; estimate_s: { '480p': number; '720p'?: number } }[];
  /** What validatePreset needs, as Map entries. */
  library: { models: [string, ModelEntry][]; templates: [string, ApiWorkflow][]; lock: [string, LockEntry][] };
  /** `prompt`: the text the photo was made from, offered by the showcase's Text to image. */
  samples: { id: string; title: { en: string; fr: string }; aspect: Aspect; url: string; placeholder: boolean; credit: string; prompt?: string }[];
  /** `hd`: the clip had an HD pass (absent in data written before it, or for a 480p clip); `recipeUrl`: a rendered clip's recipe. */
  clips: { preset: string; sample: string; url: string; verticalUrl: string; workflowUrl: string; recipeUrl?: string; placeholder: boolean; hd?: ShowcaseHdModel }[];
  /** The effects and hooks rendered on a sample in a GPU session; one without an example is not listed. */
  effects: ShowcaseExampleItem[];
  hooks: (ShowcaseExampleItem & { references: 1 | 2 })[];
  /** The feature examples (absent in data written before them). */
  features?: ShowcaseFeatureExample[];
  openStack: OpenStackReport;
};
