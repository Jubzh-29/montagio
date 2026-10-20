import type { UploadState } from '@/components/Monitor';
import { needsConsent } from '@/lib/consent';

const sample: UploadState = { status: 'ready', localUrl: '/s.png', imageRef: 'uploads/s.png', personal: false };
const imported: UploadState = { status: 'ready', localUrl: 'blob:x', imageRef: 'uploads/i.png', personal: true };

test('an effect on a sample photo asks nothing', () => {
  expect(needsConsent(sample, 'effect')).toBe(false);
});

test('a personal second photo asks for consent on a hook', () => {
  expect(needsConsent(sample, 'hook', imported)).toBe(true);
  expect(needsConsent(sample, 'hook', sample)).toBe(false);
  expect(needsConsent(imported, 'hook')).toBe(true);
});

test('camera moves never ask', () => {
  expect(needsConsent(imported, 'camera', imported)).toBe(false);
});
