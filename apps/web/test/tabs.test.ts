import type { ExtensionsInfo } from '@/lib/api-types';
import { HOOKS_READY, pickTab, READY_TABS, tabHref, TAB_ORDER, visibleTabs } from '@/lib/tabs';

/** Every tab built: the target behaviour, whatever the lots shipped so far. */
const ALL = new Set(TAB_ORDER);

const none: ExtensionsInfo = { extensions: [], effects: [], hooks: [], estimates: { t2i: 12 } };
const effect = { id: 'squish', name: 'Squish', description: '', estimate_s: 90, subjectMax: 120, modelName: 'Wan 2.1 I2V 480p (effects)', license: 'Apache-2.0' };
const hook = { id: 'iris-dive', name: 'Iris Dive', description: '', estimate_s: 160, references: 1 as const };

test('without extensions, camera then film', () => {
  expect(visibleTabs(none)).toEqual(['camera', 'film']);
  expect(visibleTabs(null)).toEqual(['camera', 'film']);
});

test('effects comes first as soon as one effect or hook is shown', () => {
  expect(visibleTabs({ ...none, extensions: ['effects'], effects: [effect] }, ALL)).toEqual(['effects', 'camera', 'film']);
  expect(visibleTabs({ ...none, extensions: ['edit', 'transitions'], hooks: [hook] }, ALL, true)).toEqual(['effects', 'camera', 'film']);
  // The extension is on but no effect is dated: nothing to show, no tab.
  expect(visibleTabs({ ...none, extensions: ['effects'] }, ALL)).toEqual(['camera', 'film']);
});

test('avatar only when the avatar extension is shown', () => {
  expect(visibleTabs({ ...none, extensions: ['avatar'] }, ALL)).toEqual(['camera', 'film', 'avatar']);
});

test('a hidden or unknown tab in the URL falls back to the first visible one', () => {
  expect(pickTab('effects', ['camera', 'film'])).toBe('camera');
  expect(pickTab('avatar', ['effects', 'camera', 'film'])).toBe('effects');
  expect(pickTab('nonsense', ['camera', 'film'])).toBe('camera');
  expect(pickTab(null, ['effects', 'camera', 'film'])).toBe('effects');
  expect(pickTab('film', ['effects', 'camera', 'film'])).toBe('film');
});

test('tabHref builds the query, in the order of TAB_ORDER', () => {
  expect(tabHref('camera')).toBe('/?tab=camera');
  expect(TAB_ORDER).toEqual(['effects', 'camera', 'film', 'avatar']);
});

test('a tab whose screen is not built yet stays hidden, whatever the extensions say', () => {
  const everything = { ...none, extensions: ['effects', 'avatar'] as const, effects: [effect] };
  expect(visibleTabs({ ...everything, extensions: [...everything.extensions] }, new Set(['camera', 'film']))).toEqual(['camera', 'film']);
  expect([...READY_TABS].every((tab) => TAB_ORDER.includes(tab))).toBe(true);
});

test('the Effects tab is built: one shown effect opens it by default', () => {
  expect(READY_TABS.has('effects')).toBe(true);
  expect(visibleTabs({ ...none, extensions: ['effects'], effects: [effect] })).toEqual(['effects', 'camera', 'film']);
});

test('hooks alone do not open the Effects tab until hooks can be rendered', () => {
  expect(HOOKS_READY).toBe(false);
  expect(visibleTabs({ ...none, extensions: ['edit', 'transitions'], hooks: [hook] })).toEqual(['camera', 'film']);
});
