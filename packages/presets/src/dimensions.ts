export type Aspect = '16:9' | '9:16' | '1:1';
export type Resolution = '480p' | '720p';

/** Map any image to the closest aspect the video models render natively. */
export function pickAspect(width: number, height: number): Aspect {
  const ratio = width / height;
  if (ratio >= 1.4) return '16:9';
  if (ratio <= 0.71) return '9:16';
  return '1:1';
}

const DIMENSIONS: Record<Resolution, Record<Aspect, { width: number; height: number }>> = {
  '480p': { '16:9': { width: 832, height: 480 }, '9:16': { width: 480, height: 832 }, '1:1': { width: 640, height: 640 } },
  '720p': { '16:9': { width: 1280, height: 720 }, '9:16': { width: 720, height: 1280 }, '1:1': { width: 960, height: 960 } },
};

export function dimensionsFor(aspect: Aspect, resolution: Resolution): { width: number; height: number } {
  return { ...DIMENSIONS[resolution][aspect] };
}

/** Wan models expect 4n+1 frames. */
export function frameCount(duration_s: number, fps: number): number {
  return 4 * Math.round((duration_s * fps) / 4) + 1;
}
