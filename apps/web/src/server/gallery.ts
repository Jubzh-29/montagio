import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Gallery order: the families of spec §6 (push and pull, pans, combined moves,
 * rhythm), with Crash Push first because the Studio preselects the first preset
 * and it shows the camera control best. Presets not listed here follow, by id.
 */
export const GALLERY_ORDER = [
  'crash-push',
  'slow-push',
  'pull-back-reveal',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'rise-and-push',
  'drift-left-push',
  'pull-back-tilt-up',
  'push-and-settle',
  'breathing',
];

export function galleryOrder<T extends { id: string }>(presets: T[]): T[] {
  const rank = (id: string) => {
    const index = GALLERY_ORDER.indexOf(id);
    return index === -1 ? GALLERY_ORDER.length : index;
  };
  return [...presets].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/**
 * Public URL of a preset preview, or undefined while its file does not exist:
 * a <video> per tile pointing at a missing file holds one of the browser's six
 * connections per origin for nothing, and twelve of them stall the app's own
 * API calls on a slow server.
 */
export async function presetPreviewUrl(root: string, preview: string): Promise<string | undefined> {
  try {
    await access(join(root, 'presets', ...preview.split('/')));
    return `/media/presets/${preview}`;
  } catch {
    return undefined;
  }
}
