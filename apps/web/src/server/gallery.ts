import { access } from 'node:fs/promises';
import { join } from 'node:path';

export { GALLERY_ORDER, galleryOrder } from '@/lib/gallery-order';

/**
 * Public URL of a preset preview, or undefined while its file does not exist:
 * a <video> per tile pointing at a missing file holds one of the browser's six
 * connections per origin for nothing, and twelve of them stall the app's own
 * API calls on a slow server. `kind` names the folder of an effect or a hook
 * (presets/effects/, presets/transitions/); a camera preset lives in presets/.
 */
export async function presetPreviewUrl(root: string, preview: string, kind?: 'effects' | 'transitions'): Promise<string | undefined> {
  const folder = kind ? ['presets', kind] : ['presets'];
  try {
    await access(join(root, ...folder, ...preview.split('/')));
    return `/media/${[...folder, preview].join('/')}`;
  } catch {
    return undefined;
  }
}
