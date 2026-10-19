import { primaryLabelKey, showcaseNoteKeys, studioCapabilities } from '@/lib/showcase-ui';

const LOCAL = { showcase: false, remixRender: true };
const STATIC_SHOWCASE = { showcase: true, remixRender: false };

test('the primary label is Show clip in the showcase, Generate film in a local sequence', () => {
  expect(primaryLabelKey('single', false, STATIC_SHOWCASE)).toBe('showcaseShowClip');
  expect(primaryLabelKey('sequence', false, STATIC_SHOWCASE)).toBe('showcaseAssembleFilm');
  expect(primaryLabelKey('single', false, LOCAL)).toBe('generate');
  expect(primaryLabelKey('sequence', false, LOCAL)).toBe('generateFilm');
  expect(primaryLabelKey('single', true, LOCAL)).toBe('generateRemix');
});

test('a showcase that renders no remix has no primary button for one: it explains instead', () => {
  expect(primaryLabelKey('single', true, STATIC_SHOWCASE)).toBeNull();
  // A showcase backed by a live GPU would render it.
  expect(primaryLabelKey('single', true, { showcase: true, remixRender: true })).toBe('generateRemix');
});

test('outside the showcase the Studio takes uploads and renders remixes', () => {
  expect(studioCapabilities(false, null)).toEqual({ uploads: true, remixRender: true });
});

test('in the showcase the Studio does what the router says it can, and nothing while it loads', () => {
  expect(studioCapabilities(true, null)).toEqual({ uploads: false, remixRender: false });
  expect(studioCapabilities(true, { capabilities: { uploads: false, remixRender: false } })).toEqual({ uploads: false, remixRender: false });
  expect(studioCapabilities(true, { capabilities: { uploads: true, remixRender: false } })).toEqual({ uploads: true, remixRender: false });
  expect(studioCapabilities(true, { capabilities: { uploads: false, remixRender: true } })).toEqual({ uploads: false, remixRender: true });
});

test('the showcase note says so when some clips are still placeholders', () => {
  expect(showcaseNoteKeys(false)).toEqual(['showcaseNote']);
  expect(showcaseNoteKeys(true)).toEqual(['showcaseNote', 'showcasePlaceholderNote']);
});
