import type { HistoryItem } from '@/lib/api-types';
import { applyReprise, canReproduce, historyFilter, replayOn, REPRODUCIBLE_TABS, repriseHref, reproducedRecipeUrl, reproducibleResult } from '@/lib/reprise';

const item = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  key: 'generation:g-1',
  source: 'generation',
  kind: 'clip',
  task: 'camera',
  name: 'Crash Push',
  modelName: 'Wan 2.2 Fun Camera',
  createdAt: '2026-10-20T10:00:00.000Z',
  previewUrl: '/media/data/generations/g-1/clip.mp4',
  downloadUrl: '/media/data/generations/g-1/clip.mp4',
  reprise: { tab: 'camera', imageRef: 'uploads/p.png', personal: true, presetId: 'crash-push', modelId: 'wan22-i2v-a14b-fun-camera', prompt: 'at dusk' },
  ...over,
});

test('repriseHref keeps the tab and the key', () => {
  expect(repriseHref(item())).toBe('/?tab=camera&from=generation%3Ag-1');
});

test('a camera clip restores its photo, preset, model and scene text', () => {
  expect(applyReprise(item())).toEqual({
    tab: 'camera',
    photo: { imageRef: 'uploads/p.png', personal: true },
    presetId: 'crash-push',
    modelId: 'wan22-i2v-a14b-fun-camera',
    prompt: 'at dusk',
  });
});

test('a reprise without photo gives the photo-missing notice', () => {
  const restore = applyReprise(item({ reprise: { tab: 'camera', photoMissing: true, presetId: 'crash-push' } }));
  expect(restore).toEqual({ tab: 'camera', presetId: 'crash-push', notice: 'photo-missing' });
});

test('a film reprise restores its shots', () => {
  const film = item({ kind: 'film', task: 'film', reprise: { tab: 'film', imageRef: 'uploads/p.png', personal: false, shots: [{ presetId: 'crash-push', prompt: 'fog' }, { presetId: 'pan-left' }] } });
  expect(applyReprise(film).shots).toEqual([{ presetId: 'crash-push', prompt: 'fog' }, { presetId: 'pan-left', prompt: '' }]);
});

test('a text-made photo gives its text to the photo, not to the scene', () => {
  const photo = item({ kind: 'photo', task: 't2i', reprise: { tab: 'camera', imageRef: 'uploads/made.png', personal: false, prompt: 'a red fox' } });
  expect(applyReprise(photo)).toEqual({ tab: 'camera', photo: { imageRef: 'uploads/made.png', personal: false }, photoPrompt: 'a red fox' });
});

test('an effect gives its subject back', () => {
  const effect = item({ task: 'effect', reprise: { tab: 'effects', imageRef: 'uploads/p.png', personal: true, effectId: 'squish', prompt: 'a toy car' } });
  expect(applyReprise(effect)).toMatchObject({ tab: 'effects', effectId: 'squish', subject: 'a toy car' });
});

test('a hook reprise opens the effects tab on that hook', () => {
  const hook = item({ task: 'hook', reprise: { tab: 'effects', imageRef: 'uploads/p.png', personal: false, hookId: 'iris-dive' } });
  expect(applyReprise(hook)).toMatchObject({ tab: 'effects', hookId: 'iris-dive', photo: { imageRef: 'uploads/p.png', personal: false } });
});

test('an avatar reprise brings back its text and language', () => {
  const avatar = item({ task: 'avatar', reprise: { tab: 'avatar', imageRef: 'uploads/p.png', personal: true, prompt: 'Bonjour à tous', language: 'fr' } });
  expect(applyReprise(avatar)).toMatchObject({ tab: 'avatar', speech: { text: 'Bonjour à tous', language: 'fr' } });
  expect(applyReprise(avatar).prompt).toBeUndefined();
});

test('a motion reprise reopens the motion tab with its texts', () => {
  const motion = item({ task: 'motion', reprise: { tab: 'motion', imageRef: 'uploads/p.png', personal: true, videoRef: 'videos/v.mp4', prompt: 'a knight', motion: 'waves' } });
  expect(applyReprise(motion)).toMatchObject({ tab: 'motion', motion: { videoRef: 'videos/v.mp4', character: 'a knight', action: 'waves' } });
  expect(applyReprise(motion).prompt).toBeUndefined();
});

test('the filter keeps one kind', () => {
  const items = [item(), item({ key: 'job:j', kind: 'photo' }), item({ key: 'sequence:s', kind: 'film' })];
  expect(historyFilter(items, 'all')).toHaveLength(3);
  expect(historyFilter(items, 'photo').map((i) => i.key)).toEqual(['job:j']);
  expect(historyFilter(items, 'film').map((i) => i.key)).toEqual(['sequence:s']);
});

describe('Reproduce: the same choices with the same seed', () => {
  const seeded = (over: Partial<HistoryItem> = {}) => item({ reprise: { ...item().reprise, seed: 1234 }, recipeUrl: '/api/recipes/generation/g-1', ...over });

  test('its link asks the Studio to reproduce', () => {
    expect(repriseHref(seeded(), { reproduce: true })).toBe('/?tab=camera&from=generation%3Ag-1&reproduce=1');
  });

  test('Reuse leaves the seed out: the next render draws its own', () => {
    expect(applyReprise(seeded()).seed).toBeUndefined();
  });

  test('Reproduce keeps it', () => {
    expect(applyReprise(seeded(), { reproduce: true }).seed).toBe(1234);
  });

  test('a film keeps the seed of each shot', () => {
    const film = item({
      kind: 'film',
      task: 'film',
      reprise: { tab: 'film', imageRef: 'uploads/p.png', shots: [{ presetId: 'crash-push', seed: 7 }, { presetId: 'pan-left', seed: 8 }] },
    });
    expect(applyReprise(film, { reproduce: true }).shotSeeds).toEqual([7, 8]);
    expect(applyReprise(film).shotSeeds).toBeUndefined();
  });

  test('only the tabs the Studio reopens whole can be reproduced', () => {
    expect([...REPRODUCIBLE_TABS].sort()).toEqual(['avatar', 'camera', 'effects', 'film', 'motion']);
    expect(canReproduce(seeded())).toBe(true);
    expect(canReproduce(seeded({ kind: 'photo', task: 't2i' }))).toBe(false);
    expect(canReproduce(seeded({ task: 'ad', reprise: { tab: 'effects', effectId: 'squish', seed: 3 } }))).toBe(false);
    expect(canReproduce(seeded({ task: 'voice-change', reprise: { tab: 'avatar' } }))).toBe(false);
    expect(canReproduce(item())).toBe(false);
  });

  test('a result on screen can be reproduced on the same tabs, an ad cannot', () => {
    expect(reproducibleResult('camera')).toBe(true);
    expect(reproducibleResult('effects', 'effect')).toBe(true);
    expect(reproducibleResult('effects', 'ad')).toBe(false);
    expect(reproducibleResult('avatar', 'voice-change')).toBe(false);
  });

  test('the seed brought back holds on its own tab only: another tab draws its own', () => {
    const replay = { tab: 'camera' as const, seed: 1234 };
    expect(replayOn(replay, 'camera')).toBe(replay);
    expect(replayOn(replay, 'effects')).toBeNull();
    expect(replayOn(null, 'camera')).toBeNull();
  });

  test('an HD clip reproduces the clip it was made from: its recipe is the one compared', () => {
    const hd = seeded({ task: 'upscale', recipeUrl: '/api/recipes/job/j-hd', reproduces: '/api/recipes/generation/g-1' });
    expect(reproducedRecipeUrl(hd)).toBe('/api/recipes/generation/g-1');
    expect(reproducedRecipeUrl(seeded())).toBe('/api/recipes/generation/g-1');
  });
});
