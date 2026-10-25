import type { ExtensionsInfo, PresetSummary } from '@/lib/api-types';
import { exploreTools, featuredCards } from '@/lib/explore';

const preset = (id: string, previewUrl?: string): PresetSummary => ({
  id,
  name: id,
  description: '',
  ...(previewUrl ? { previewUrl } : {}),
  poses: [],
  speed: 1,
  defaultModel: 'm',
});

const info = (over: Partial<ExtensionsInfo> = {}): ExtensionsInfo => ({
  extensions: [],
  effects: [],
  hooks: [],
  estimates: { t2i: 5 },
  ...over,
});

const effect = (id: string, previewUrl?: string) => ({
  id,
  name: id,
  description: '',
  ...(previewUrl ? { previewUrl } : {}),
  estimate_s: 80,
  subjectMax: 120,
  modelId: 'wan21-i2v-effects',
  modelName: 'Wan 2.1',
  license: 'Apache-2.0',
});

test('the featured cards show camera moves, then effects and hooks only when the Studio shows them', () => {
  const presets = [preset('crash-push', '/a.mp4'), preset('drift-left-push', '/drift.mp4')];
  expect(featuredCards(presets, null).map((card) => card.id)).toEqual(['camera']);
  expect(featuredCards(presets, null)[0]!.previewUrl).toBe('/drift.mp4');
  const withWall = info({
    effects: [effect('squish', '/squish.mp4'), effect('explode', '/explode.mp4')],
    hooks: [{ ...effect('ignite', '/ignite.mp4'), references: 1 }],
  });
  const cards = featuredCards(presets, withWall);
  expect(cards.map((card) => card.id)).toEqual(['camera', 'effects', 'hooks']);
  expect(cards.map((card) => card.previewUrl)).toEqual(['/drift.mp4', '/squish.mp4', '/ignite.mp4']);
});

test('a card falls back to another preview, and to none when the list has no preview at all', () => {
  expect(featuredCards([preset('crash-push', '/crash.mp4')], null)[0]!.previewUrl).toBe('/crash.mp4');
  expect(featuredCards([preset('crash-push')], null)[0]!.previewUrl).toBeUndefined();
});

test("an extension's tool shows only when the extension is shown", () => {
  const ids = (extensions: ExtensionsInfo['extensions']) => exploreTools([], info({ extensions })).map((tool) => tool.id);
  expect(ids([])).toEqual(['camera', 'film', 'characters', 'community', 't2i', 'comfy']);
  expect(ids(['edit', 'avatar', 'motion', 'upscale', 'music'])).toEqual(['camera', 'film', 'characters', 'community', 'ads', 'avatar', 'motion', 't2i', 'edit', 'hd', 'music', 'comfy']);
  expect(exploreTools([], info(), true).map((tool) => tool.id)).not.toContain('characters');
  // The restyle opens the Motion tab in its restyle mode.
  const restyle = exploreTools([], info({ extensions: ['restyle'] })).find((tool) => tool.id === 'restyle');
  expect(restyle).toMatchObject({ href: '/?tab=motion&mode=restyle', name: 'restyleTitle' });
  // The object swap opens it in its swap mode, after the restyle it requires.
  expect(exploreTools([], info({ extensions: ['restyle', 'swap'] })).map((tool) => tool.id)).toEqual(['camera', 'film', 'characters', 'restyle', 'swap', 't2i', 'comfy']);
  expect(exploreTools([], info({ extensions: ['restyle', 'swap'] })).find((tool) => tool.id === 'swap')).toMatchObject({ href: '/?tab=motion&mode=swap', name: 'swapTitle' });
  // The community gallery is in the showcase too: its rendered clips, remixed on their sample photo.
  expect(exploreTools([], info(), true).map((tool) => tool.id)).toContain('community');
});
