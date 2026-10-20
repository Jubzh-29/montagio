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

test('the showcase explains what it cannot do, in English and in French', () => {
  const expected = {
    'showcase-upload': 'errorShowcaseUpload',
    'showcase-remix': 'errorShowcaseRemix',
    'not-in-showcase': 'errorNotInShowcase',
    'model-not-in-showcase': 'errorNotInShowcase',
    'montage-busy': 'errorMontageBusy',
    'ffmpeg-unavailable': 'errorFfmpegUnavailable',
  } as const;
  for (const [code, key] of Object.entries(expected)) {
    expect(refusalMessageKey(code), code).toBe(key);
    for (const dictionary of [en, fr] as Record<string, string>[]) expect(dictionary[key], key).toBeTruthy();
  }
  expect((en as Record<string, string>).errorShowcaseUpload).toMatch(/pre-generated/);
  expect((fr as Record<string, string>).errorShowcaseUpload).toMatch(/pré-générés/);
});

test('a film FFmpeg could not join gets its own message, in English and in French', () => {
  // Sent by the server's assembly (server/sequences.ts) and by the showcase montage in the browser.
  expect(refusalMessageKey('ffmpeg-failed')).toBe('errorFfmpegFailed');
  expect((en as Record<string, string>).errorFfmpegFailed).toMatch(/FFmpeg/);
  expect((fr as Record<string, string>).errorFfmpegFailed).toMatch(/FFmpeg/);
});

test('the photo and effect refusals say what to do, in English and in French', () => {
  const expected = {
    'blocked-name': 'errorBlockedName',
    'consent-required': 'errorConsentRequired',
    'extension-disabled': 'errorExtensionDisabled',
    'invalid-input': 'errorInvalidInput',
    'showcase-t2i': 'errorShowcaseT2i',
  } as const;
  for (const [code, key] of Object.entries(expected)) {
    expect(refusalMessageKey(code)).toBe(key);
    for (const dictionary of [en, fr] as Record<string, string>[]) expect(dictionary[key], key).toBeTruthy();
  }
});
