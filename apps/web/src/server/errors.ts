/** Stable codes of a refused photo, effect or extension request; the client explains each one. */
export type JobErrorCode = 'extension-disabled' | 'invalid-input' | 'consent-required' | 'blocked-name' | 'unknown-image' | 'ffmpeg-missing';

export class JobError extends Error {
  constructor(readonly code: JobErrorCode) {
    super(code);
  }
}
