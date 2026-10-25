import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Spec rule: the competitor's brand is named only in the README and, for search, in the
// description of the Space card (the user's choice on 2026-10-25, with the repository's
// description and topics, which live on GitHub). Never in the app, the showcase or the video.
// The word is assembled at runtime so this test does not name it.
const brand = ['higgs', 'field'].join('');
const SPACE_CARD = 'apps/web/showcase-space/README.md';

test('only the README and the Space card mention the competitor brand', () => {
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
  expect(files.sort()).toEqual(['README.md', SPACE_CARD]);
});

test('the Space card names it in its short description only, not on the page', () => {
  const card = readFileSync(new URL(`../../../${SPACE_CARD}`, import.meta.url), 'utf8');
  const lines = card.split(/\r?\n/).filter((line) => line.toLowerCase().includes(brand));
  expect(lines.map((line) => line.split(':')[0])).toEqual(['short_description']);
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(card)?.[1] ?? '';
  expect(frontMatter.toLowerCase()).toContain(brand);
});
