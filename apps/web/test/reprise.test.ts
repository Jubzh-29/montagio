import type { HistoryItem } from '@/lib/api-types';
import { applyReprise, historyFilter, repriseHref } from '@/lib/reprise';

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

test('a restyle reprise reopens the motion tab in its restyle mode, its image as the look, never as the start photo', () => {
  const restyle = item({ task: 'restyle', reprise: { tab: 'motion', restyle: true, imageRef: 'uploads/l.png', personal: false, videoRef: 'videos/v.mp4', prompt: 'a snowy evening' } });
  const back = applyReprise(restyle);
  expect(back).toMatchObject({ tab: 'motion', restyle: { videoRef: 'videos/v.mp4', text: 'a snowy evening', look: { imageRef: 'uploads/l.png', personal: false } } });
  expect(back.photo).toBeUndefined();
  expect(back.motion).toBeUndefined();
  const without = applyReprise(item({ task: 'restyle', reprise: { tab: 'motion', restyle: true, prompt: 'snow' } }));
  expect(without.restyle).toEqual({ text: 'snow' });
});

test('the filter keeps one kind', () => {
  const items = [item(), item({ key: 'job:j', kind: 'photo' }), item({ key: 'sequence:s', kind: 'film' })];
  expect(historyFilter(items, 'all')).toHaveLength(3);
  expect(historyFilter(items, 'photo').map((i) => i.key)).toEqual(['job:j']);
  expect(historyFilter(items, 'film').map((i) => i.key)).toEqual(['sequence:s']);
});
