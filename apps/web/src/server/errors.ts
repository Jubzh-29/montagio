/** Stable codes of a refused photo, effect or extension request; the client explains each one. */
export type JobErrorCode = 'extension-disabled' | 'invalid-input' | 'consent-required' | 'blocked-name' | 'unknown-image' | 'ffmpeg-missing'
  // An avatar's voice came out longer than the avatar model animates (15 s): the job ends with it.
  | 'speech-too-long';

export class JobError extends Error {
  constructor(readonly code: JobErrorCode) {
    super(code);
  }
}
