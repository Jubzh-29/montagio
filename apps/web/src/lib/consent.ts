import type { UploadState } from '@/components/Monitor';

/** What the Studio is about to do with the photo. */
export type PhotoAction = 'edit' | 'effect' | 'hook' | 'avatar' | 'camera';

/**
 * The consent box shows for an edit, an effect, a hook or an avatar on a photo that is, or
 * derives from, an imported one (the server checks the same rule). Camera moves never ask.
 */
export function needsConsent(photo: UploadState, action: PhotoAction): boolean {
  return action !== 'camera' && photo.status === 'ready' && photo.personal;
}
