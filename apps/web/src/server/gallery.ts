import { access } from 'node:fs/promises';
import { join } from 'node:path';

export { GALLERY_ORDER, galleryOrder } from '@/lib/gallery-order';

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
