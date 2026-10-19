import { normalizeBasePath, normalizeRepoUrl } from '../scripts/build-options.mjs';

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

test('the repository URL is an absolute https URL, or absent', () => {
  expect(normalizeRepoUrl(undefined)).toBe('');
  expect(normalizeRepoUrl('  ')).toBe('');
  expect(normalizeRepoUrl(' https://github.com/someone/montagio ')).toBe('https://github.com/someone/montagio');
});

test('a repository URL that is not absolute https, or that carries credentials, is refused', () => {
  for (const raw of ['github.com/someone/montagio', '/someone/montagio', 'http://github.com/someone/montagio', 'javascript:alert(1)', 'git@github.com:someone/montagio.git']) {
    expect(() => normalizeRepoUrl(raw), raw).toThrow(/MONTAGIO_REPO_URL must be an absolute https URL/);
  }
  // A clone URL with a token would publish the token on the page.
  expect(() => normalizeRepoUrl('https://user:token@github.com/someone/montagio')).toThrow(/credentials/);
});
