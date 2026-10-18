import { primaryLabelKey, showcaseNoteKeys } from '@/lib/showcase-ui';

test('the primary label is Show clip in the showcase, Generate film in a local sequence', () => {
  expect(primaryLabelKey('single', false, true)).toBe('showcaseShowClip');
  expect(primaryLabelKey('sequence', false, true)).toBe('showcaseAssembleFilm');
  expect(primaryLabelKey('single', false, false)).toBe('generate');
  expect(primaryLabelKey('sequence', false, false)).toBe('generateFilm');
  expect(primaryLabelKey('single', true, false)).toBe('generateRemix');
});

test('the showcase has no primary button for a remix: it explains instead', () => {
  expect(primaryLabelKey('single', true, true)).toBeNull();
});

test('the showcase note says so when some clips are still placeholders', () => {
  expect(showcaseNoteKeys(false)).toEqual(['showcaseNote']);
  expect(showcaseNoteKeys(true)).toEqual(['showcaseNote', 'showcasePlaceholderNote']);
});
