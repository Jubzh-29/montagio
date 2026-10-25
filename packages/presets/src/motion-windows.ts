/** The one window Wan2.2-Animate-2 renders at once (81 frames, 5 s at 16 fps). */
export const MOTION_WINDOW_FRAMES = 81;
/**
 * The core context windows (ContextWindowsManual, the official template's switch): past one window,
 * the sampler walks the clip in windows of 21 latent frames overlapping by 8, fused in a pyramid.
 */
export const MOTION_CONTEXT_LENGTH = 21;
export const MOTION_CONTEXT_OVERLAP = 8;

/** How many windows a clip of `frames` frames is sampled in: what its render time scales with. */
export function motionWindows(frames: number): number {
  if (frames <= MOTION_WINDOW_FRAMES) return 1;
  const latent = (frames - 1) / 4 + 1;
  return Math.ceil((latent - MOTION_CONTEXT_LENGTH) / (MOTION_CONTEXT_LENGTH - MOTION_CONTEXT_OVERLAP)) + 1;
}

/** The frames a motion transfer renders for a clip of `seconds` at 16 fps (4n+1, up to `max_s`). */
export function motionFrames(seconds: number, max_s = 30): number {
  const available = Math.floor(seconds * 16);
  return Math.min(max_s * 16 + 1, 4 * Math.ceil((available - 1) / 4) + 1);
}
