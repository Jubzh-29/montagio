import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The installer core runs before `npm ci`, on bare Node: it may import node: modules and its own .ts files only.
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const sources = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));

test('the installer core imports node: modules and relative .ts files only', () => {
  expect(sources.length).toBeGreaterThan(0);
  for (const name of sources) {
    const text = readFileSync(join(srcDir, name), 'utf8');
    const specifiers = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    for (const specifier of specifiers) {
      const ok = specifier.startsWith('node:') || (specifier.startsWith('./') && specifier.endsWith('.ts'));
      expect(ok, `${name} imports ${specifier}`).toBe(true);
    }
  }
});

test('bare Node runs the core from outside the repository', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'montagio-bare-'));
  try {
    for (const name of sources) {
      execFileSync(process.execPath, [join(srcDir, name)], { cwd, stdio: 'pipe' });
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  // One bare node per source file: about 3 s alone, more beside the other test files.
}, 30_000);
