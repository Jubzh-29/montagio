import type { EffectPreset, Library, TransitionPreset } from '@montagio/presets';
import { enabledExtensions, extensionEstimate, type ExtensionId, type ExtensionModel } from '@montagio/registry';
import type { EffectSummary, ExtensionsInfo, HookSummary } from '@/lib/api-types';
import { EFFECT_ORDER, HOOK_ORDER, wallOrder } from '@/lib/wall-order';
import { getEnv } from './env';
import { JobError } from './errors';
import { presetPosterUrl, presetPreviewUrl } from './gallery';
import { currentProfile, offeredModel } from './profile';
import { getServices } from './services';

/** The full path (no distillation LoRA, 20 steps) against the 4-step one: about 5 times longer (EXTENSIONS_ANALYSE.md §4). */
export const QUALITY_FACTOR = 5;
/** Text-to-image is not an extension: its estimate comes from the core model. */
const T2I_MODEL = 'z-image-turbo';
const T2I_FALLBACK_S = 12;

/** The wall's order: the most adopted effect first, then the spectacular ones; others follow. */

// Extensions ComfyUI refused (a node or a file missing), for the life of this process,
// shared by every route bundle like the services.
const holder = globalThis as typeof globalThis & { __montagioRejected?: Map<ExtensionId, string> };
const rejected = (holder.__montagioRejected ??= new Map<ExtensionId, string>());

/** Hide `extension` until the app restarts: ComfyUI cannot run it here. */
export function markRejected(extension: ExtensionId, reason: string): void {
  if (!rejected.has(extension)) console.warn(`[montagio] extension ${extension} is hidden until the app restarts: ${reason}`);
  rejected.set(extension, reason);
}

export function resetRejectedForTests(): void {
  rejected.clear();
  captionsRefusal.reason = null;
}

// The captions run in the extension "avatar" but are optional in it: a ComfyUI without the transcription
// node or its model hides them alone, until the app restarts (the avatar, voice change and translation stay).
const captionsHolder = globalThis as typeof globalThis & { __montagioCaptionsRefusal?: { reason: string | null } };
const captionsRefusal = (captionsHolder.__montagioCaptionsRefusal ??= { reason: null });

export function markCaptionsRejected(reason: string): void {
  if (captionsRefusal.reason === null) console.warn(`[montagio] captions are hidden until the app restarts: ${reason}`);
  captionsRefusal.reason = reason;
}

export const captionsRejected = () => captionsRefusal.reason !== null;

/**
 * The captions are offered with the extension "avatar" (validated for real on a CPU ComfyUI and in the
 * browser on 2026-10-25), unless ComfyUI refused their workflow.
 */
export async function captionsOffered(): Promise<boolean> {
  return !captionsRejected() && (await visibleExtensions()).includes('avatar');
}

const showsEverything = () => process.env.MONTAGIO_EXTENSIONS?.trim() === 'all';

/** Features kept behind a flag until a GPU session validates them (MONTAGIO_EXPERIMENTAL, a comma list). */
export const EXPERIMENTAL_FEATURES = ['moodboard', 'palette-photo'] as const;
export type ExperimentalFeature = (typeof EXPERIMENTAL_FEATURES)[number];

export function experimentalFeatures(): ExperimentalFeature[] {
  const asked = (process.env.MONTAGIO_EXPERIMENTAL ?? '').split(',').map((entry) => entry.trim());
  return EXPERIMENTAL_FEATURES.filter((feature) => asked.includes(feature));
}

/** A feature behind the flag answers as a hidden extension does while the flag leaves it out. */
export function requireExperimental(feature: ExperimentalFeature): void {
  if (!experimentalFeatures().includes(feature)) throw new JobError('extension-disabled');
}

/**
 * The extensions the Studio shows: what MONTAGIO_EXTENSIONS allows (the dated ones when
 * unset), minus those ComfyUI refused and those that require a hidden one. An invalid
 * flag shows nothing, and the log says why.
 */
export async function visibleExtensions(): Promise<ExtensionId[]> {
  const config = (await getServices().library).extensions ?? [];
  let enabled: ExtensionId[];
  try {
    enabled = enabledExtensions(config, process.env.MONTAGIO_EXTENSIONS, currentProfile());
  } catch (error) {
    console.error(`[montagio] MONTAGIO_EXTENSIONS is invalid, no extension is shown: ${error instanceof Error ? error.message : error}`);
    return [];
  }
  const shown = new Set(enabled.filter((id) => !rejected.has(id)));
  for (const entry of config) {
    if (entry.requires.some((required) => !shown.has(required))) shown.delete(entry.id);
  }
  return enabled.filter((id) => shown.has(id));
}

/** A preset shows once a GPU session dated it, or always with MONTAGIO_EXTENSIONS=all. */
const dated = (preset: { gpu_validated: string | null }) => preset.gpu_validated !== null || showsEverything();

export async function visibleEffects(): Promise<EffectPreset[]> {
  if (!(await visibleExtensions()).includes('effects')) return [];
  return wallOrder([...(await getServices().library).effects.values()].filter(dated), EFFECT_ORDER);
}

export async function visibleHooks(): Promise<TransitionPreset[]> {
  if (!(await visibleExtensions()).includes('transitions')) return [];
  return wallOrder([...(await getServices().library).hooks.values()].filter(dated), HOOK_ORDER);
}

/** The time of a job on `model` in this install's memory profile, at 4 steps or on the full path. */
export function estimateFor(model: ExtensionModel, fast: boolean): number {
  const estimate = extensionEstimate(model, currentProfile());
  return fast ? estimate : estimate * QUALITY_FACTOR;
}

/** Refuse a request for a hidden extension with 404 extension-disabled. */
export async function requireExtension(id: ExtensionId): Promise<void> {
  if (!(await visibleExtensions()).includes(id)) throw new JobError('extension-disabled');
}

/** GET /api/extensions: what the Studio may show, with the wall's tiles and the time estimates. */
/** The voice and the avatar models of the extension "avatar". */
export function avatarModels(lib: Library): { voice: ExtensionModel; avatar: ExtensionModel } {
  const models = [...lib.extensionModels.values()];
  const voice = models.find((model) => model.task === 'tts');
  const avatar = models.find((model) => model.task === 'ia2v-talk');
  if (!voice || !avatar) throw new Error('no tts or ia2v-talk model in registry/extensions');
  return { voice, avatar };
}

/** The music model of the extension "music". */
export function musicModel(lib: Library): ExtensionModel {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 't2a');
  if (!model) throw new Error('no t2a model in registry/extensions');
  return model;
}

/** The motion transfer model of the extension "motion". */
export function motionModel(lib: Library): ExtensionModel {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'motion-transfer');
  if (!model) throw new Error('no motion-transfer model in registry/extensions');
  return model;
}

/** The transcription model of the captions (extension "avatar"), if the registry has one. */
export function transcribeModel(lib: Library): ExtensionModel | undefined {
  return [...lib.extensionModels.values()].find((entry) => entry.task === 'a2t-words');
}

/** The 1080p model of the extension "upscale". */
export function upscaleModel(lib: Library): ExtensionModel {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'v2v-upscale');
  if (!model) throw new Error('no v2v-upscale model in registry/extensions');
  return model;
}

/** The HD photo model of the extension "upscale". */
export function imageUpscaleModel(lib: Library): ExtensionModel {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-upscale');
  if (!model) throw new Error('no i2i-upscale model in registry/extensions');
  return model;
}

/** What a caption names of an extension model. */
const summaryOf = (model: ExtensionModel) => ({ id: model.id, name: model.name, license: model.license });

export async function extensionsInfo(): Promise<ExtensionsInfo> {
  const lib = await getServices().library;
  const { root } = getEnv();
  const extensions = await visibleExtensions();
  const modelOf = (id: string) => lib.extensionModels.get(id);
  const effects = await Promise.all(
    (await visibleEffects()).map(async (preset): Promise<EffectSummary> => {
      const model = modelOf(preset.models.preferred);
      const previewUrl = await presetPreviewUrl(root, preset.preview, 'effects');
      const posterUrl = previewUrl && (await presetPosterUrl(root, preset.preview, 'effects'));
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        ...(previewUrl ? { previewUrl } : {}),
        ...(posterUrl ? { posterUrl } : {}),
        estimate_s: model ? estimateFor(model, preset.defaults.fast) : 0,
        subjectMax: model?.limits.max_chars ?? 120,
        modelId: preset.models.preferred,
        modelName: model?.name ?? preset.models.preferred,
        license: model?.license ?? '',
      };
    }),
  );
  const editModel = [...lib.extensionModels.values()].find((model) => model.task === 'i2i-edit');
  const hooks = await Promise.all(
    (await visibleHooks()).map(async (preset): Promise<HookSummary> => {
      const model = modelOf(preset.models.preferred);
      const previewUrl = await presetPreviewUrl(root, preset.preview, 'transitions');
      const posterUrl = previewUrl && (await presetPosterUrl(root, preset.preview, 'transitions'));
      const fast = preset.defaults.fast;
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        ...(previewUrl ? { previewUrl } : {}),
        ...(posterUrl ? { posterUrl } : {}),
        estimate_s: (editModel ? estimateFor(editModel, fast) : 0) + (model ? estimateFor(model, fast) : 0),
        references: preset.end_frame.references,
        modelId: preset.models.preferred,
        modelName: model?.name ?? preset.models.preferred,
        license: model?.license ?? '',
      };
    }),
  );
  const t2i = offeredModel(lib, T2I_MODEL)?.estimate_s['720p'] ?? T2I_FALLBACK_S;
  const avatar = extensions.includes('avatar') ? avatarModels(lib) : null;
  const music = extensions.includes('music') ? musicModel(lib) : null;
  const upscale = extensions.includes('upscale') ? upscaleModel(lib) : null;
  const imageUpscale = extensions.includes('upscale') ? imageUpscaleModel(lib) : null;
  const voiceChange = extensions.includes('avatar') ? [...lib.extensionModels.values()].find((entry) => entry.task === 'a2a-vc') : undefined;
  const translate = extensions.includes('avatar') ? [...lib.extensionModels.values()].find((entry) => entry.task === 'a2a-translate') : undefined;
  const motion = extensions.includes('motion') ? motionModel(lib) : null;
  const words = extensions.includes('avatar') && !captionsRejected() ? transcribeModel(lib) : undefined;
  // A tab without a wall shows what it makes: a render of the GPU session, looping (presets/extensions/previews).
  const examples: NonNullable<ExtensionsInfo['examples']> = {};
  for (const id of ['avatar', 'motion'] as const) {
    if (!extensions.includes(id)) continue;
    const previewUrl = await presetPreviewUrl(root, `previews/${id}.mp4`, 'extensions');
    const posterUrl = previewUrl && (await presetPosterUrl(root, `previews/${id}.mp4`, 'extensions'));
    if (previewUrl) examples[id] = { previewUrl, ...(posterUrl ? { posterUrl } : {}) };
  }
  return {
    extensions,
    effects,
    hooks,
    experimental: experimentalFeatures(),
    estimates: {
      t2i,
      ...(extensions.includes('edit') && editModel ? { edit: estimateFor(editModel, true) } : {}),
      ...(avatar ? { avatar: estimateFor(avatar.voice, true) + estimateFor(avatar.avatar, true) } : {}),
      ...(music ? { music: estimateFor(music, true) } : {}),
      ...(upscale ? { upscale: estimateFor(upscale, true) } : {}),
      ...(imageUpscale ? { imageUpscale: estimateFor(imageUpscale, true) } : {}),
      ...(voiceChange ? { voiceChange: estimateFor(voiceChange, true) } : {}),
      ...(translate && avatar ? { translate: estimateFor(translate, true) + estimateFor(avatar.avatar, true) } : {}),
      ...(motion ? { motion: estimateFor(motion, true) } : {}),
    },
    ...(extensions.includes('edit') && editModel ? { editModel: summaryOf(editModel) } : {}),
    ...(avatar ? { avatarModel: summaryOf(avatar.avatar) } : {}),
    ...(music ? { musicModel: summaryOf(music) } : {}),
    ...(upscale ? { upscaleModel: { ...summaryOf(upscale), maxFrames: upscale.limits.max_input_frames ?? 121 } } : {}),
    ...(motion ? { motionModel: summaryOf(motion) } : {}),
    ...(words ? { captions: { estimate_s: estimateFor(words, true), model: summaryOf(words) } } : {}),
    ...(Object.keys(examples).length > 0 ? { examples } : {}),
    ...((process.env.MONTAGIO_BACKEND ?? 'demo') === 'demo' ? { demo: true } : {}),
    ...(currentProfile() === '12gb' ? { vramProfile: '12gb' as const } : {}),
  };
}
