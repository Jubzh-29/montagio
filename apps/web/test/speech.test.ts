import { estimateSpeech, speechHint } from '@/lib/speech';

test('300 French characters are estimated over 15 s', () => {
  expect(estimateSpeech('a'.repeat(300), 'fr')).toBe(23.1);
  expect(estimateSpeech('a'.repeat(300), 'fr')).toBeGreaterThan(15);
});

test('an English sentence is estimated at 15 characters a second', () => {
  expect(estimateSpeech('a'.repeat(45), 'en')).toBe(3);
  expect(estimateSpeech('  hello there  ', 'en')).toBe(0.7);
  expect(estimateSpeech('', 'en')).toBe(0);
});

test('the composer warns of a speech too short or too long for the avatar', () => {
  expect(speechHint(0)).toBeNull();
  expect(speechHint(0.4)).toBe('too-short');
  expect(speechHint(3)).toBeNull();
  expect(speechHint(15)).toBeNull();
  expect(speechHint(15.1)).toBe('too-long');
});
