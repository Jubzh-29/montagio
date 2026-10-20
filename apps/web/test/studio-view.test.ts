import { nextView } from '@/lib/studio-view';

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
