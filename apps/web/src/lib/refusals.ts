import type { MessageKey } from '@/i18n';

/** Server refusals worth their own message; any other code shows the generic error. */
const REFUSALS: Record<string, MessageKey> = {
  'ffmpeg-missing': 'errorFfmpegMissing',
  'workflow-rejected': 'errorWorkflowRejected',
  'backend-unavailable': 'errorBackendUnavailable',
  // The static showcase (src/showcase/router.ts).
  'showcase-upload': 'errorShowcaseUpload',
  'showcase-remix': 'errorShowcaseRemix',
  'not-in-showcase': 'errorNotInShowcase',
  'model-not-in-showcase': 'errorNotInShowcase',
  'montage-busy': 'errorMontageBusy',
  'ffmpeg-unavailable': 'errorFfmpegUnavailable',
};

export function refusalMessageKey(code: string | undefined): MessageKey {
  return (code !== undefined && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined) ?? 'errorGeneric';
}
