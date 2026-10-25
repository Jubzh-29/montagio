export type PresetSummary = {
  id: string;
  name: string;
  description: string;
  /** Absent while the preset has no preview file yet. */
  previewUrl?: string;
  /** The still shown while the preview loads. */
  posterUrl?: string;
  /** Showcase: the preview loops a placeholder clip (camera move simulated by FFmpeg). */
  previewPlaceholder?: boolean;
  poses: string[];
  speed: number;
  defaultModel: string;
};

export type ModelSummary = {
  id: string;
  name: string;
  kind: 'video' | 'image';
  tier: 'quality' | 'turbo' | 'fast';
  license: string;
  estimate_s: { '480p': number; '720p'?: number };
};

/** Where a photo comes from (server/uploads.ts). */
export type PhotoOrigin = 'upload' | 'sample' | 't2i' | 'edit' | 'frame';

export type UploadResult = {
  imageRef: string;
  width: number;
  height: number;
  aspect: '16:9' | '9:16' | '1:1';
  origin: PhotoOrigin;
  /** The photo is, or derives from, an imported one: an effect on it asks for consent. */
  personal: boolean;
};

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/**
 * A demo render (no GPU): the clip a GPU session made of the same sample photo, or the photo
 * moved by FFmpeg. Absent for a model's render.
 */
export type DemoKind = 'example' | 'moved';

export type GenerationRecord = {
  id: string;
  presetId: string;
  modelId: string;
  state: JobState;
  progress: number;
  outputUrl?: string;
  error?: string;
  remix?: boolean;
  /** The delivered clip's frame count (HD takes 121 at most). */
  frames?: number;
  /** The showcase's pre-built workflow; elsewhere the Studio asks /api/workflows/:id. */
  workflowUrl?: string;
  /** The showcase's recipe; elsewhere the Studio asks /api/recipes/generation/:id. */
  recipeUrl?: string;
  /** A showcase clip whose camera move FFmpeg simulated, waiting for the GPU session. */
  placeholder?: boolean;
  /** Showcase: the model that restored the clip to 1080p (its HD pass), named in its caption. */
  hdModel?: HdModelSummary;
  demo?: DemoKind;
  /** A demo example rendered by another model than the job's (a 20-step clip for a Turbo job): the one its caption names. */
  demoModelId?: string;
};

/** The upscaler of a showcase clip's HD pass (SeedVR2). */
export type HdModelSummary = { id: string; name: string; license: string };

/** What a model makes, in the order of the Open Stack page (as @montagio/check-open-stack lists them). */
export type StackFunction = 'camera' | 'effects' | 'transitions' | 'photo' | 'avatar' | 'music' | 'hd' | 'motion';

export type OpenStackReport = {
  ok: boolean;
  checkedAt: string;
  /** Every model the Studio can run, grouped by function; `extension` is absent for those every install has. */
  models: {
    id: string;
    name: string;
    function: StackFunction;
    license: string;
    extension?: string;
    weights: { id: string; license: string; file?: string; bytes?: number; source?: string }[];
  }[];
  violations: { rule: string; file: string; detail: string }[];
};

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['succeeded', 'failed', 'canceled']);

export type SequenceSummary = {
  id: string;
  state: 'running' | 'assembling' | 'succeeded' | 'failed' | 'canceled';
  shots: { presetId: string; state: string; modelId?: string }[];
  currentShot: number;
  progress: number;
  outputUrl?: string;
  verticalUrl?: string;
  error?: string;
  /** The last music added under the film (POST /api/sequences/:id/music). */
  music?: { jobId: string };
  /** Showcase: at least one shot is a placeholder clip. */
  placeholder?: boolean;
  /** Showcase: the film's recipe; elsewhere /api/recipes/sequence/:id. */
  recipeUrl?: string;
  /** Showcase: every shot had the same HD pass, so the film is in 1080p. */
  hdModel?: HdModelSummary;
  /** Showcase: what the in-browser montage is doing while the film is assembling. */
  stage?: 'loading-ffmpeg' | 'joining';
};

/** A sample photo of the showcase, picked instead of an upload. */
export type SampleSummary = {
  id: string;
  title: { en: string; fr: string };
  aspect: '16:9' | '9:16' | '1:1';
  imageRef: `samples/${string}`;
  url: string;
  placeholder: boolean;
  /** The text the photo was made from (Z-Image-Turbo), offered by the showcase's Text to image. */
  prompt?: string;
};

/** What the static showcase offers (GET /api/showcase, answered in the page). */
export type ShowcaseInfo = {
  samples: SampleSummary[];
  model: { id: string; name: string; license: string };
  /** What a live GPU backend would add; the static showcase has neither. */
  capabilities: { uploads: boolean; remixRender: boolean };
  /** Some clips are still placeholders (before the GPU session). */
  placeholders: boolean;
  /** Every clip had an HD pass: the slate says 1080p instead of the render's 480p. */
  hd: boolean;
  repoUrl: string | null;
};

/** The seven extensions, as registry/extensions.yaml names them. */
export type ExtensionId = 'edit' | 'effects' | 'transitions' | 'avatar' | 'music' | 'upscale' | 'motion';

/** A one-photo effect of the wall (GET /api/extensions). */
export type EffectSummary = {
  id: string;
  name: string;
  description: string;
  /** Absent while the effect has no preview file yet. */
  previewUrl?: string;
  /** The still shown while the preview loads. */
  posterUrl?: string;
  estimate_s: number;
  /** The longest "what the photo shows" the effects model takes. */
  subjectMax: number;
  /** The model that renders it and its license, for the caption under the clip (its id links to its Open Stack line). */
  modelId: string;
  modelName: string;
  license: string;
  /** Showcase: the sample photos it has an example for. */
  samples?: string[];
};

/** A keyframe hook of the wall: an edit makes its end frame, then a transition. */
export type HookSummary = {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
  posterUrl?: string;
  estimate_s: number;
  /** 2: the hook needs a second photo (an outfit). */
  references: 1 | 2;
  /** Showcase: the sample photos it has an example for. */
  samples?: string[];
  /** The transition model, for the caption under the clip. */
  modelId: string;
  modelName: string;
  license: string;
};

/** What the Studio may show: the extensions the flag and the GPU dates allow, and the time estimates. */
export type ExtensionsInfo = {
  extensions: ExtensionId[];
  /** Features shown only with MONTAGIO_EXPERIMENTAL (not validated on a GPU yet). */
  experimental?: ('moodboard' | 'palette-photo')[];
  effects: EffectSummary[];
  hooks: HookSummary[];
  estimates: { t2i: number; edit?: number; avatar?: number; music?: number; upscale?: number; imageUpscale?: number; motion?: number; voiceChange?: number; translate?: number };
  /** The photo edit's model, for the caption under an edit (the preset catalogue does not hold it). */
  editModel?: { id: string; name: string; license: string };
  /** The avatar model, for the caption under a talking avatar. */
  avatarModel?: { id: string; name: string; license: string };
  /** The music model, for the caption under a film with music. */
  musicModel?: { id: string; name: string; license: string };
  /** The 1080p model, and the longest clip it takes (frames): the HD action shows only up to it. */
  upscaleModel?: { id: string; name: string; license: string; maxFrames: number };
  /** The motion transfer model, for the caption under its clip. */
  motionModel?: { id: string; name: string; license: string };
  /** The demo backend answers (no GPU): a result is a stand-in clip, and its caption says no model ran. */
  demo?: boolean;
  /** The install runs the 12 GB profile: the Studio says why Quality is not offered. */
  vramProfile?: '12gb';
  /** A render of what Avatar and Motion make, looping in their card and on their empty monitor. */
  examples?: Partial<Record<'avatar' | 'motion', { previewUrl: string; posterUrl?: string }>>;
};

export type JobTask = 't2i' | 'edit' | 'effect' | 'hook' | 'avatar' | 'music' | 'upscale' | 'image-upscale' | 'motion' | 'ad' | 'voice-change' | 'moodboard' | 'translate';

import type { CharacterKind, CharacterType } from './characters';

export type { CharacterKind, CharacterType };

/** A picture of a character: its portrait's edit in a new scene (the photodump). */
export type CharacterPhotoSummary = {
  imageRef: string;
  url: string;
  /** What the picture shows: the Studio's description when it is animated. */
  scene: string;
  /** The history item that brings the picture back in the Studio (?from=). */
  historyKey?: string;
  createdAt: string;
};

/** A saved character (GET /api/characters). */
export type CharacterSummary = {
  id: string;
  name: string;
  type: CharacterType;
  /** Who the character is; absent on the characters made before the kinds. */
  kind?: CharacterKind;
  description: string;
  imageRef: string;
  imageUrl: string;
  /** The history item that brings the portrait back in the Studio. */
  portraitHistoryKey?: string;
  createdAt: string;
  photos: CharacterPhotoSummary[];
};

/** A photo, effect or chained render (GET /api/jobs/:id). */
export type JobSummary = {
  id: string;
  task: JobTask;
  state: JobState;
  progress: number;
  outputUrl?: string;
  /** An image output registered as an upload: usable as the start photo. */
  outputImageRef?: string;
  personal?: boolean;
  /** An intermediate image already made (a hook's end frame), shown while the rest renders. */
  stepImageUrl?: string;
  label: { itemId?: string; name?: string };
  modelId: string;
  error?: string;
  /** The showcase's pre-built workflow; elsewhere the Studio asks /api/workflows/:id. */
  workflowUrl?: string;
  /** The showcase's recipe; elsewhere the Studio asks /api/recipes/job/:id. */
  recipeUrl?: string;
  frames?: number;
  /** A film's 9:16 cut with music. */
  verticalUrl?: string;
  /** Showcase: an example still waiting for the GPU session. */
  placeholder?: boolean;
  /** Showcase: the model that restored the example to 1080p (its HD pass). */
  hdModel?: HdModelSummary;
  demo?: DemoKind;
  createdAt: string;
};

/** What it takes to make a history item again: the Studio reopens its tab with these (GET /api/history). */
export type Reprise = {
  tab: 'effects' | 'camera' | 'film' | 'avatar' | 'motion';
  imageRef?: string;
  /** The photo is, or derives from, an imported one: an effect on it asks for consent. */
  personal?: boolean;
  /** The start photo is gone (data wiped): the reprise reopens everything but the photo. */
  photoMissing?: true;
  presetId?: string;
  effectId?: string;
  hookId?: string;
  prompt?: string;
  /** The language an avatar speaks. */
  language?: 'en' | 'fr';
  /** A motion transfer's reference clip (absent once it is gone), and what its character does. */
  videoRef?: string;
  motion?: string;
  modelId?: string;
  /** A remixed clip: the remix editor reopens on that generation's preset text. */
  remixGenerationId?: string;
  /** Where the remix editor reads the preset text from, when it is not a generation of this machine (a community entry). */
  presetUrl?: string;
  /** No photo of its own: the Studio starts from the tab's sample photo (a community share file or example). */
  sample?: true;
  /** The seed it was rendered with: Reproduce sends it back, Reuse leaves it out. */
  seed?: number;
  shots?: { presetId: string; prompt?: string; seed?: number }[];
};

/** One finished creation, newest first (GET /api/history). */
export type HistoryItem = {
  /** `${source}:${id}`, unique across the list. */
  key: string;
  /** "community": an entry of the community gallery, brought back the same way. */
  source: 'generation' | 'sequence' | 'job' | 'community';
  kind: 'photo' | 'clip' | 'film';
  task: 'camera' | 'film' | JobTask;
  name: string;
  modelName: string;
  createdAt: string;
  previewUrl: string;
  downloadUrl: string;
  reprise: Reprise;
  /** Its recipe (GET): the workflow, the weights, the seed and the stack that made it. */
  recipeUrl?: string;
  /** The recipe a Reproduce of this item makes again, when it is not its own: an HD clip reopens the clip it was made from. */
  reproduces?: string;
};
