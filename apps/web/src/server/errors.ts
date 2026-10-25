/** Stable codes of a refused photo, effect or extension request; the client explains each one. */
export type JobErrorCode = 'extension-disabled' | 'invalid-input' | 'consent-required' | 'blocked-name' | 'unknown-image' | 'ffmpeg-missing'
  // An avatar's voice came out longer or shorter than the avatar model animates (1 to 15 s): the job ends with it.
  | 'speech-too-long'
  | 'speech-too-short'
  // A motion transfer without the user's word that they hold the rights on the video and the photo.
  | 'rights-required'
  // Captions: a language they are not made in (server/tasks/captions.ts), a clip without a voice.
  | 'language-unsupported'
  | 'no-speech';

export class JobError extends Error {
  constructor(readonly code: JobErrorCode) {
    super(code);
  }
}
