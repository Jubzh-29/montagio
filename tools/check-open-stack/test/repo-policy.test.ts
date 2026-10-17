import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Spec rule: the competitor's brand is named only in the README "Context"
// section. The word is assembled at runtime so this test does not name it.
const brand = ['higgs', 'field'].join('');

test('only the README mentions the competitor brand', () => {
  let files: string[] = [];
  try {
    files = execFileSync('git', ['grep', '-i', '-l', brand, '--', '.', ':!package-lock.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches
    if ((error as { status?: number }).status !== 1) throw error;
  }
  expect(files).toEqual(['README.md']);
});
