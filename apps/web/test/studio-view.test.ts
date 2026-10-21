import { nextView, tabEvent } from '@/lib/studio-view';

test('a tab the visitor opens brings its wall back', () => {
  expect(tabEvent({ tab: 'effects', known: true }, { tab: 'camera', known: true })).toBe('tab');
});

test('the extensions arriving only settle the guessed tab: an open atelier stays open', () => {
  expect(tabEvent({ tab: 'camera', known: false }, { tab: 'effects', known: true })).toBeNull();
  expect(tabEvent({ tab: 'camera', known: false }, { tab: 'camera', known: true })).toBeNull();
});

test('Generate shows the result', () => {
  expect(nextView('generate', { view: 'gallery', before: 'gallery' })).toEqual({ view: 'result', before: 'gallery' });
});

test('Change brings the gallery back', () => {
  expect(nextView('change', { view: 'result', before: 'gallery' })).toEqual({ view: 'gallery', before: 'gallery' });
});

test('a new tab opens on its gallery', () => {
  expect(nextView('tab', { view: 'result', before: 'gallery' })).toEqual({ view: 'gallery', before: 'gallery' });
});

test('closing the atelier returns to the view before it', () => {
  const open = nextView('open-atelier', { view: 'result', before: 'gallery' });
  expect(open).toEqual({ view: 'atelier', before: 'result' });
  expect(nextView('close-atelier', open)).toEqual({ view: 'result', before: 'result' });
  // Opening it twice keeps the first view to come back to.
  expect(nextView('open-atelier', open)).toEqual(open);
});

test('a new photo shows on the monitor; from the atelier, closing it returns there', () => {
  expect(nextView('photo', { view: 'gallery', before: 'gallery' })).toEqual({ view: 'result', before: 'gallery' });
  // "Use this photo" in the atelier: the photo arrives first, then the atelier closes onto the monitor.
  const atelier = nextView('photo', { view: 'atelier', before: 'gallery' });
  expect(atelier).toEqual({ view: 'atelier', before: 'result' });
  expect(nextView('close-atelier', atelier)).toEqual({ view: 'result', before: 'result' });
});
