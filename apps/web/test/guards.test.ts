import { JobError } from '@/server/errors';
import { assertConsent, assertNoBlockedName, blockedNames, findBlockedName, normalizeForMatch } from '@/server/guards';
import type { UploadMeta } from '@/server/uploads';
import { setupTempData } from './helpers';

setupTempData();

const names = ['Taylor Swift', 'Zinédine Zidane', 'Elon Musk'];

test('a listed name is found whatever the case and the accents', () => {
  expect(findBlockedName('portrait of TAYLOR SWIFT on stage', names)).toBe('Taylor Swift');
  expect(findBlockedName('zinedine zidane scores', names)).toBe('Zinédine Zidane');
  expect(findBlockedName('Elon-Musk, smiling', names)).toBe('Elon Musk');
});

test('a name inside another word is not found', () => {
  expect(findBlockedName('a taylor swiftly sewing a coat', names)).toBeNull();
  expect(findBlockedName('elon musky perfume', names)).toBeNull();
});

test('a text without any listed name passes', () => {
  expect(findBlockedName('a red fox in the snow at dawn', names)).toBeNull();
  expect(normalizeForMatch('  Ça  VA  ')).toBe('ca va');
});

test('the repository list is read once, with its comments left out', async () => {
  const list = await blockedNames();
  expect(list.length).toBeGreaterThanOrEqual(80);
  expect(list).toContain('Taylor Swift');
  expect(list.some((name) => name.startsWith('#'))).toBe(false);
  expect(await blockedNames()).toBe(list);
});

test('assertNoBlockedName refuses with blocked-name, ignores missing texts', async () => {
  await expect(assertNoBlockedName('a fox', undefined)).resolves.toBeUndefined();
  await expect(assertNoBlockedName('a fox', 'Taylor Swift dancing')).rejects.toMatchObject({ code: 'blocked-name' });
});

const photo = (personal: boolean): UploadMeta => ({ imageRef: 'uploads/x.png', width: 4, height: 3, aspect: '1:1', origin: personal ? 'upload' : 'sample', personal });

test('consent is required for a personal photo only', () => {
  expect(() => assertConsent(photo(true), undefined)).toThrow(JobError);
  expect(() => assertConsent(photo(true), true)).not.toThrow();
  expect(() => assertConsent(photo(false), undefined)).not.toThrow();
});

test('consent: "true" (a string) is not consent', () => {
  expect(() => assertConsent(photo(true), 'true')).toThrow(expect.objectContaining({ code: 'consent-required' }));
});
