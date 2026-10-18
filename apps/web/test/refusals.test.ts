import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import { refusalMessageKey } from '@/lib/refusals';

test('a refusal the user can act on gets its own message, anything else the generic one', () => {
  expect(refusalMessageKey('ffmpeg-missing')).toBe('errorFfmpegMissing');
  expect(refusalMessageKey('workflow-rejected')).toBe('errorWorkflowRejected');
  expect(refusalMessageKey('backend-unavailable')).toBe('errorBackendUnavailable');
  expect(refusalMessageKey('backend-error')).toBe('errorGeneric');
  expect(refusalMessageKey(undefined)).toBe('errorGeneric');
});

test('those messages exist in English and in French', () => {
  const dictionaries = [en, fr] as Record<string, string>[];
  for (const key of ['errorFfmpegMissing', 'errorWorkflowRejected', 'errorBackendUnavailable']) {
    for (const dictionary of dictionaries) expect(dictionary[key], key).toBeTruthy();
  }
  expect((en as Record<string, string>).errorFfmpegMissing).toMatch(/FFmpeg/);
});
