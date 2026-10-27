import { JobError } from '@/server/errors';
import {
  assertAllowedText,
  assertConsent,
  assertNoBlockedName,
  assertNoBlockedTerm,
  blockedNames,
  blockedTerms,
  findBlockedName,
  findBlockedTerm,
  normalizeForMatch,
} from '@/server/guards';
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

describe('the explicit text guard', () => {
  let contentFilter: string | undefined;

  beforeEach(() => {
    contentFilter = process.env.MONTAGIO_CONTENT_FILTER;
    delete process.env.MONTAGIO_CONTENT_FILTER;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (contentFilter === undefined) delete process.env.MONTAGIO_CONTENT_FILTER;
    else process.env.MONTAGIO_CONTENT_FILTER = contentFilter;
    process.env.MONTAGIO_BACKEND = 'demo';
    vi.restoreAllMocks();
  });

  test('a listed term is found with folded case and punctuation, as a whole phrase', () => {
    expect(findBlockedTerm('EXPLICIT, SEXUAL content', ['explicit sexual content'])).toBe('explicit sexual content');
  });

  test('a listed string inside an ordinary word is not found', () => {
    expect(findBlockedTerm('a historic house in Sussex', ['sex'])).toBeNull();
    expect(findBlockedTerm('un renard roux dans la neige', ['nu', 'nue'])).toBeNull();
  });

  test('the repository term list is read once, with its comments left out', async () => {
    const list = await blockedTerms();
    expect(list).toContain('explicit sexual content');
    expect(list).toContain('sex');
    expect(list.some((term) => term.startsWith('#'))).toBe(false);
    expect(await blockedTerms()).toBe(list);
  });

  test('assertAllowedText checks names first, then terms, and accepts ordinary text', async () => {
    await expect(assertAllowedText('a red fox in the snow', undefined)).resolves.toBeUndefined();
    await expect(assertAllowedText('Taylor Swift, explicit sexual content')).rejects.toMatchObject({ code: 'blocked-name' });
    await expect(assertAllowedText('explicit sexual content')).rejects.toMatchObject({ code: 'blocked-term' });
    await expect(assertNoBlockedTerm(undefined, 'a red fox')).resolves.toBeUndefined();
  });

  test('ordinary non-explicit uses of ambiguous words are not refused', async () => {
    const prompts = [
      'a beige dress with nude heels',
      'a classical nude sculpture in a museum',
      'an adult video tutorial about photography',
      'an adult educational documentary about wildlife',
      'a museum display of a ceremonial fetish object',
      'une statue de nu classique dans un musée',
      'un fétiche cérémoniel dans un musée',
      'une étude de la nudité dans l’art classique',
    ];
    for (const prompt of prompts) {
      await expect(assertAllowedText(prompt), prompt).resolves.toBeUndefined();
    }
  });

  test('the local opt-out disables terms only, never names', async () => {
    process.env.MONTAGIO_BACKEND = 'local';
    process.env.MONTAGIO_CONTENT_FILTER = 'off';
    await expect(assertAllowedText('explicit sexual content')).resolves.toBeUndefined();
    await expect(assertAllowedText('Taylor Swift dancing')).rejects.toMatchObject({ code: 'blocked-name' });
  });

  test('the opt-out is ignored outside a local backend', async () => {
    process.env.MONTAGIO_BACKEND = 'demo';
    process.env.MONTAGIO_CONTENT_FILTER = 'off';
    await expect(assertAllowedText('explicit sexual content')).rejects.toMatchObject({ code: 'blocked-term' });
  });
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
