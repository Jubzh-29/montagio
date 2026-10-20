import type { MessageKey } from '@/i18n';

/** Server refusals worth their own message; any other code shows the generic error. */
const REFUSALS: Record<string, MessageKey> = {
  'ffmpeg-missing': 'errorFfmpegMissing',
  // The film's assembly failed: on the server (server/sequences.ts) or in the showcase's browser.
  'ffmpeg-failed': 'errorFfmpegFailed',
  'workflow-rejected': 'errorWorkflowRejected',
  'backend-unavailable': 'errorBackendUnavailable',
  // The static showcase (src/showcase/router.ts).
  'showcase-upload': 'errorShowcaseUpload',
  'showcase-remix': 'errorShowcaseRemix',
  'not-in-showcase': 'errorNotInShowcase',
  'model-not-in-showcase': 'errorNotInShowcase',
  'montage-busy': 'errorMontageBusy',
  'ffmpeg-unavailable': 'errorFfmpegUnavailable',
  // Photos, effects and extensions (server/jobs.ts, server/guards.ts).
  'blocked-name': 'errorBlockedName',
  'consent-required': 'errorConsentRequired',
  'extension-disabled': 'errorExtensionDisabled',
  'invalid-input': 'errorInvalidInput',
  'showcase-t2i': 'errorShowcaseT2i',
  // An avatar job whose voice is over 15 s (server/tasks/avatar.ts).
  'speech-too-long': 'avatarTooLong',
  'speech-too-short': 'avatarTooShort',
  // A motion transfer without the rights box (server/tasks/motion.ts).
  'rights-required': 'errorRightsRequired',
};

export function refusalMessageKey(code: string | undefined): MessageKey {
  return (code !== undefined && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined) ?? 'errorGeneric';
}

/** A refusal after which the server hides an extension: the Studio asks /api/extensions again, so its button goes. */
export function hidesExtension(code: string | undefined): boolean {
  return code === 'workflow-rejected' || code === 'extension-disabled';
}
