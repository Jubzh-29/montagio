import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import { presetTextUrl, resultRemixAction, type RemixEditorState } from '@/lib/remix';

const library = { id: 'g-lib', presetId: 'crash-push' };
const remixed = { id: 'g-rx', presetId: 'crash-push', remix: true };
const editor = (over: Partial<RemixEditorState> = {}): RemixEditorState => ({
  baseId: 'crash-push',
  text: 'as opened',
  original: 'as opened',
  ...over,
});

test('a past remix reads its own text back, a library generation reads the library file', () => {
  expect(presetTextUrl(remixed)).toBe('/api/generations/g-rx/preset');
  expect(presetTextUrl(library)).toBe('/api/presets/crash-push/yaml');
});

test('with the editor closed, the result opens its preset', () => {
  expect(resultRemixAction(null, remixed)).toBe('open');
  expect(resultRemixAction(null, library)).toBe('open');
});

test('an editor that holds this remix gets the focus, edited since or not', () => {
  expect(resultRemixAction(editor({ generationId: 'g-rx' }), remixed)).toBe('focus');
  expect(resultRemixAction(editor({ generationId: 'g-rx', text: 'edited since' }), remixed)).toBe('focus');
});

test('an editor opened on the library preset of this generation gets the focus', () => {
  expect(resultRemixAction(editor({ text: 'edited' }), library)).toBe('focus');
});

test('an editor on another preset, or on another remix of the same preset, is replaced', () => {
  expect(resultRemixAction(editor({ baseId: 'pan-left' }), library)).toBe('open');
  expect(resultRemixAction(editor(), remixed)).toBe('open');
  expect(resultRemixAction(editor({ generationId: 'g-older' }), remixed)).toBe('open');
});

test('unsaved edits of another preset are not replaced without asking', () => {
  expect(resultRemixAction(editor({ baseId: 'pan-left', text: 'edited' }), library)).toBe('confirm');
  expect(resultRemixAction(editor({ text: 'edited' }), remixed)).toBe('confirm');
  expect(resultRemixAction(editor({ generationId: 'g-older', text: 'edited' }), remixed)).toBe('confirm');
});

test('the question exists in English and in French, with the preset name', () => {
  for (const dictionary of [en, fr] as Record<string, string>[]) expect(dictionary.remixReplace).toMatch(/\{name\}/);
});
