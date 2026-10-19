import { normalizeBasePath } from '../scripts/build-options.mjs';

test('a base path is written with one leading slash and no trailing one', () => {
  expect(normalizeBasePath(undefined)).toBe('');
  expect(normalizeBasePath('')).toBe('');
  expect(normalizeBasePath('/montagio')).toBe('/montagio');
  // Without the slash: what Git Bash users type, since it turns "/montagio" into a Windows path.
  expect(normalizeBasePath('montagio')).toBe('/montagio');
  expect(normalizeBasePath('/montagio/')).toBe('/montagio');
  expect(normalizeBasePath('a/b')).toBe('/a/b');
});

test('a path Git Bash rewrote, or one with spaces, is refused with a hint', () => {
  expect(() => normalizeBasePath('C:/Program Files/Git/montagio')).toThrow(/without the leading slash/);
  expect(() => normalizeBasePath('/sho trig')).toThrow(/--base-path/);
});
