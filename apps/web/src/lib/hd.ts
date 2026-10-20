import type { ExtensionsInfo } from './api-types';

/**
 * The HD 1080p action shows for a clip the upscale model takes: the extension shown, and a
 * known frame count within the model's limit (121). A clip whose frame count is unknown gets
 * no button rather than one whose click fails.
 */
export function canUpscale(clip: { frames?: number }, info: ExtensionsInfo | null): boolean {
  const model = info?.upscaleModel;
  return model !== undefined && clip.frames !== undefined && clip.frames <= model.maxFrames;
}
