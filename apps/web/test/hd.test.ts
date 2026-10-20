import type { ExtensionsInfo } from '@/lib/api-types';
import { canUpscale } from '@/lib/hd';

const none: ExtensionsInfo = { extensions: [], effects: [], hooks: [], estimates: { t2i: 12 } };
const shown: ExtensionsInfo = {
  ...none,
  extensions: ['upscale'],
  estimates: { t2i: 12, upscale: 240 },
  upscaleModel: { id: 'seedvr2-upscale', name: 'SeedVR2 3B', license: 'Apache-2.0', maxFrames: 121 },
};

test('no HD for a clip of 122 frames', () => {
  expect(canUpscale({ frames: 122 }, shown)).toBe(false);
  expect(canUpscale({ frames: 121 }, shown)).toBe(true);
});

test('no HD without a frame count', () => {
  expect(canUpscale({}, shown)).toBe(false);
});

test('no HD when upscale is hidden', () => {
  expect(canUpscale({ frames: 81 }, none)).toBe(false);
  expect(canUpscale({ frames: 81 }, null)).toBe(false);
});

test('HD for an 81-frame clip', () => {
  expect(canUpscale({ frames: 81 }, shown)).toBe(true);
});
