import type { Library } from '@montagio/presets';
import { modelInProfile, vramProfile, type ModelEntry, type VramProfile } from '@montagio/registry';

/**
 * The install's memory profile, MONTAGIO_VRAM_PROFILE (the local installer sets it): "standard" for a
 * 24 GB card, "12gb" for a 12 to 20 GB one. An unknown value is read as "12gb", the profile that offers less.
 */
export function currentProfile(): VramProfile {
  try {
    return vramProfile(process.env.MONTAGIO_VRAM_PROFILE);
  } catch (error) {
    console.error(`[montagio] ${error instanceof Error ? error.message : error}: the 12 GB profile applies`);
    return '12gb';
  }
}

/** The models of the library this install offers, with their times in its profile. */
export function offeredModels(lib: Library, profile = currentProfile()): ModelEntry[] {
  return [...lib.models.values()].flatMap((model) => modelInProfile(model, profile) ?? []);
}

/** A model the profile offers, by id, or undefined. */
export function offeredModel(lib: Library, id: string, profile = currentProfile()): ModelEntry | undefined {
  const model = lib.models.get(id);
  return (model && modelInProfile(model, profile)) ?? undefined;
}

/**
 * The model a preset starts on in this profile: its preferred one, else its fallback, else the first
 * offered model that renders its moves pose by pose (the Turbo of a 12 GB install).
 */
export function presetModel(lib: Library, preset: { capability: string; models: { preferred: string; fallback?: string } }, profile = currentProfile()): string {
  const { preferred, fallback } = preset.models;
  if (offeredModel(lib, preferred, profile)) return preferred;
  const camera = offeredModels(lib, profile).find((model) => model.capabilities.includes('i2v-camera'));
  if (camera) return camera.id;
  if (fallback && offeredModel(lib, fallback, profile)) return fallback;
  return preferred;
}
