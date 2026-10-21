import { needsScene, restoredScene, SCENE_MAX, sceneMissing, sceneOf } from '@/lib/scene';

test('the camera moves ask for a description of the photo, the other tabs do not', () => {
  expect(needsScene('camera', false)).toBe(true);
  expect(needsScene('film', false)).toBe(true);
  for (const tab of ['effects', 'avatar', 'motion'] as const) expect(needsScene(tab, false)).toBe(false);
});

test('the showcase plays clips already rendered: it asks for nothing', () => {
  expect(needsScene('camera', true)).toBe(false);
  expect(sceneMissing('camera', true, '')).toBe(false);
});

test('an empty or blank description blocks a camera move only', () => {
  expect(sceneMissing('camera', false, '')).toBe(true);
  expect(sceneMissing('film', false, '   ')).toBe(true);
  expect(sceneMissing('camera', false, 'a harbour at dawn')).toBe(false);
  expect(sceneMissing('effects', false, '')).toBe(false);
});

test('a photo made from a text comes with that text, cut on a word to the field', () => {
  expect(sceneOf('  a fishing harbour  at golden hour ')).toBe('a fishing harbour at golden hour');
  const long = `${'boat '.repeat(120)}harbour`;
  const cut = sceneOf(long);
  expect(cut.length).toBeLessThanOrEqual(SCENE_MAX);
  expect(cut.endsWith('boat')).toBe(true);
});

test('a photo with no known text comes with no description', () => {
  expect(sceneOf(undefined)).toBe('');
});

test('a Reuse brings back the scene it was rendered with, else the text of its photo', () => {
  expect(restoredScene({ prompt: 'a harbour at dawn', photoPrompt: 'a harbour' })).toBe('a harbour at dawn');
  expect(restoredScene({ photoPrompt: 'a red fox in the snow' })).toBe('a red fox in the snow');
  expect(restoredScene({})).toBe('');
});
