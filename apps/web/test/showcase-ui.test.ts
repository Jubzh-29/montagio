import { primaryLabelKey, showcaseArrival, showcaseNoteKeys, studioCapabilities } from '@/lib/showcase-ui';

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

// As the showcase ships it: the harbour comes first, the effects (in the wall's order) were rendered on the convertible and the raincoat.
const harbour = { id: 'landscape-a' };
const convertible = { id: 'landscape-b' };
const raincoat = { id: 'portrait-a' };
const samples = [harbour, convertible, raincoat];
const shown = [
  { id: 'squish', samples: ['landscape-b'] },
  { id: 'frozen-moment', samples: ['landscape-b', 'portrait-a'] },
];

test('the showcase arrives on the first sample photo with an effect example, and plays that effect', () => {
  expect(showcaseArrival(samples, shown, null)).toEqual({ sample: convertible, effect: shown[0] });
  expect(showcaseArrival([raincoat, convertible], shown, null)).toEqual({ sample: raincoat, effect: shown[1] });
});

test('without an effect example, the arrival is the first sample photo, for a camera clip', () => {
  expect(showcaseArrival(samples, [], null)).toEqual({ sample: harbour });
  expect(showcaseArrival(samples, undefined, null)).toEqual({ sample: harbour });
  // An effect without examples is a local one: no example to play.
  expect(showcaseArrival(samples, [{ id: 'squish' }], null)).toEqual({ sample: harbour });
});

test('a URL that asks for another tab than Effects arrives on the first sample photo', () => {
  expect(showcaseArrival(samples, shown, 'camera')).toEqual({ sample: harbour });
  expect(showcaseArrival(samples, shown, 'effects')).toEqual({ sample: convertible, effect: shown[0] });
});

test('no sample photo, no arrival', () => {
  expect(showcaseArrival([], shown, null)).toBeUndefined();
});
