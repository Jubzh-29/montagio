import { RegistryError } from './errors';
import type { ExtensionModel } from './extensions';
import { VRAM_PROFILES, type ModelEntry, type VramProfile } from './schema';

/** MONTAGIO_VRAM_PROFILE: unset, empty or "standard" for a 24 GB card; "12gb" for the 12 GB profile. */
export function vramProfile(flag: string | undefined): VramProfile {
  const value = flag?.trim() || 'standard';
  if (!(VRAM_PROFILES as readonly string[]).includes(value)) {
    throw new RegistryError(`MONTAGIO_VRAM_PROFILE: unknown profile ${JSON.stringify(value)} (expected ${VRAM_PROFILES.join(' or ')})`);
  }
  return value as VramProfile;
}

/** The model as `profile` offers it, with its times there; null when that profile does not offer it. */
export function modelInProfile(model: ModelEntry, profile: VramProfile): ModelEntry | null {
  if (profile === 'standard') return model;
  if (!model.low_vram || model.low_vram.gpu_validated === null) return null;
  return { ...model, estimate_s: model.low_vram.estimate_s };
}

/** An extension model's time for a typical job in `profile`: its 12 GB measure there, when a GPU session took one. */
export function extensionEstimate(model: ExtensionModel, profile: VramProfile): number {
  return profile === '12gb' && model.low_vram ? model.low_vram.estimate_s : model.estimate_s;
}
