import { estimateSpeech } from '@/lib/speech';

test('300 French characters are estimated over 15 s', () => {
  expect(estimateSpeech('a'.repeat(300), 'fr')).toBe(23.1);
  expect(estimateSpeech('a'.repeat(300), 'fr')).toBeGreaterThan(15);
});

test('an English sentence is estimated at 15 characters a second', () => {
  expect(estimateSpeech('a'.repeat(45), 'en')).toBe(3);
  expect(estimateSpeech('  hello there  ', 'en')).toBe(0.7);
  expect(estimateSpeech('', 'en')).toBe(0);
});
