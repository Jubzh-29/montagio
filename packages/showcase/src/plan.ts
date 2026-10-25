import { dimensionsFor, UPSCALE_TARGETS, type Aspect, type Library, type Preset, type Resolution } from '@montagio/presets';
import { clipFile, verticalFile, workflowFile, type ClipEntry, type Manifest, type SampleEntry } from './manifest';

/** The size of a rendered file of the showcase: the render's own, or 1080p once it had its HD pass. */
export const renderedSize = (aspect: Aspect, resolution: Resolution, hd: boolean): { width: number; height: number } =>
  hd ? { ...UPSCALE_TARGETS[aspect] } : dimensionsFor(aspect, resolution);

/** One preset × sample pair of the showcase, with the clip rendered for it if there is one. */
export type PlannedClip = {
  preset: Preset;
  sample: SampleEntry;
  file: string;
  vertical: string;
  workflow: string;
  rendered: ClipEntry | null;
};

/** Every preset of the library on every sample: library order first, then sample order. */
export function planClips(manifest: Manifest, library: Pick<Library, 'presets'>): PlannedClip[] {
  const rendered = new Map(manifest.clips.map((clip) => [`${clip.preset}|${clip.sample}`, clip]));
  return [...library.presets.values()].flatMap((preset) =>
    manifest.samples.map((sample) => ({
      preset,
      sample,
      file: clipFile(preset.id, sample.id),
      vertical: verticalFile(preset.id, sample.id),
      workflow: workflowFile(preset.id, sample.id),
      rendered: rendered.get(`${preset.id}|${sample.id}`) ?? null,
    })),
  );
}

/** Rendered clips whose preset is no longer in the library. */
export function strayClips(manifest: Manifest, library: Pick<Library, 'presets'>): ClipEntry[] {
  return manifest.clips.filter((clip) => !library.presets.has(clip.preset));
}
