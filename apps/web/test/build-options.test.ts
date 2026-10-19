import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextBuildKind, normalizeBasePath, normalizeRepoUrl } from '../scripts/build-options.mjs';

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

test('tells a production build in .next from a static export, and from a dev-only folder', () => {
  const web = mkdtempSync(join(tmpdir(), 'montagio-next-'));
  const nextDir = join(web, '.next');
  /** What next build 16.4.2 leaves in .next: BUILD_ID, and the config in required-server-files.json. */
  const build = (output: string | undefined) => {
    writeFileSync(join(nextDir, 'BUILD_ID'), 'abc');
    writeFileSync(join(nextDir, 'required-server-files.json'), JSON.stringify({ version: 1, config: { output, distDir: '.next' } }));
  };
  try {
    expect(nextBuildKind(nextDir)).toBe('none');
    // next dev keeps its state in .next/dev only.
    mkdirSync(join(nextDir, 'dev'), { recursive: true });
    expect(nextBuildKind(nextDir)).toBe('none');
    build('export');
    expect(nextBuildKind(nextDir)).toBe('export');
    // `next build` without the showcase: what next start (and the local installer) serves.
    build(undefined);
    expect(nextBuildKind(nextDir)).toBe('server');
    build('standalone');
    expect(nextBuildKind(nextDir)).toBe('server');
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});
