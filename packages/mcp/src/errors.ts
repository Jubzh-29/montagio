/**
 * What a tool says when the app refuses a request or a render fails: the app's own code
 * (server/jobs.ts, server/generations.ts, lib/refusals.ts in apps/web) and a sentence a
 * person or an agent can act on.
 */
const MESSAGES: Record<string, string> = {
  // Refusals of a request (HTTP 4xx/5xx with { error: code }).
  'consent-required':
    'This photo was imported, so it may show a real person. Ask the user to confirm that they are the person in the photo, or that this person has agreed, then call again with consent: true. Never set it on their behalf.',
  'rights-required':
    'A motion transfer needs the user\'s word that they hold the rights on the photo and the video. Ask them, then call again with rights: true. Never set it on their behalf.',
  'blocked-name': 'The text names a well-known person. Montagio does not make images of real people without their consent.',
  'extension-disabled': 'This feature, effect or hook is not available on this installation. list_effects_and_hooks shows what is.',
  'invalid-input': 'This request cannot be rendered. Check the text (its length too) and the options, then try again.',
  'invalid-request': 'The request misses a field the app needs.',
  'invalid-json': 'The app could not read the request.',
  'missing-idempotency-key': 'The app wants an Idempotency-Key header on this request.',
  'unknown-image': 'The app does not know this imageRef. Upload the photo again (upload_photo), or take an imageRef from list_history.',
  'unknown-preset': 'No camera preset has this id. list_camera_presets lists them.',
  'model-incompatible': 'This model cannot render this preset. Leave modelId out to use the preset\'s own model.',
  'invalid-preset': 'The preset is not valid.',
  'preset-too-large': 'The preset is too large.',
  'ffmpeg-missing': 'FFmpeg is not installed on the server. Install it (or set MONTAGIO_FFMPEG to its path), then try again.',
  'ffmpeg-failed': 'FFmpeg could not assemble the result. Please try again.',
  'workflow-rejected': 'ComfyUI refused this workflow (a missing node or model file). The app hides this feature until it restarts; its log has the details.',
  'backend-unavailable': 'The ComfyUI server cannot be reached. Check that it is running, then try again.',
  'backend-error': 'ComfyUI failed on this request. The app log has the details.',
  'not-found': 'No render has this id on this Montagio.',
  // A render that ended badly (its record's error).
  'speech-too-long': 'The speech came out longer than 15 s, the most an avatar animates. Shorten the text and try again.',
  'speech-too-short': 'The speech came out shorter than 1 s, the least an avatar animates. Write a longer text and try again.',
  lost: 'The app lost track of this render. Start it again.',
  'no-output': 'The render finished without an output file.',
  'deliver-failed': 'The render finished, but the app could not deliver its file. The app log has the details.',
  failed: 'The render failed. The app log has the details.',
  canceled: 'The render was canceled.',
  // This server's own checks.
  'invalid-arguments': 'The arguments do not fit this tool.',
  'file-not-found': 'There is no file at this path.',
  'unsupported-file': 'This kind of file is not accepted.',
  'file-too-large': 'This file is too large.',
  'download-failed': 'The finished file could not be downloaded.',
  // Reproducing a recipe.
  'invalid-recipe': 'This is not a Montagio recipe (montagio/recipe@1): give its JSON file, or the MP4 or PNG Montagio exported, which carries it.',
  'not-replayable':
    'This recipe holds no request the app can send again: a voice change or a translation (their speech file and its consent come from the user, never from a recipe), captions made on one of them, or a recipe cut short in a file\'s tags. Its workflow can still be loaded in ComfyUI.',
  'inputs-required': 'The recipe needs its input files: give the photo (and the other files it names) to render it again.',
  'recipe-unavailable': 'The app could not make this recipe. Its log says why.',
  aborted: 'The call was canceled before the render ended. The render goes on in the app; get_job follows it.',
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? `The app refused the request (${code}).`;
}

/** A tool's failure: a stable code, a readable message, and what helps to go on (an id, an imageRef). */
export class ToolFailure extends Error {
  readonly details: Record<string, unknown>;

  constructor(
    readonly code: string,
    message?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message ?? messageFor(code));
    this.details = details;
  }
}

/** Codes worth a new try while polling: the app or its GPU backend is busy or briefly out of reach. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ToolFailure)) return false;
  return error.code === 'app-unreachable' || error.code === 'backend-unavailable' || /^http-5\d\d$/.test(error.code);
}

/** Any error as a ToolFailure: never a stack trace, never a file's content. */
export function toFailure(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error;
  return new ToolFailure('internal', error instanceof Error ? error.message : String(error));
}
