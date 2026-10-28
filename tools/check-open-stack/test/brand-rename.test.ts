import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const legacy = ['shot', 'rig'].join('');
const legacyBytes = Buffer.from(legacy);
const overlap = legacyBytes.length - 1;
const chunkSize = 64 * 1024;

const findLegacyBrand = async (root: string): Promise<string[]> => {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const violations: string[] = [];

  for (const path of paths) {
    if (path.toLowerCase().includes(legacy)) violations.push(`${path} (path)`);

    let tail = Buffer.alloc(0);
    let found = false;
    for await (const chunk of createReadStream(join(root, path), { highWaterMark: chunkSize })) {
      const buffer = chunk as Buffer;
      const searchable = Buffer.concat([tail, buffer]);
      const lowercase = Buffer.from(searchable.toString('latin1').toLowerCase(), 'latin1');
      if (!found && lowercase.includes(legacyBytes)) {
        violations.push(`${path} (content)`);
        found = true;
      }
      tail = searchable.subarray(Math.max(0, searchable.length - overlap));
    }
  }

  return violations;
};

const scratchRepos: string[] = [];
const scratchRepo = (files: Record<string, string | Buffer>): string => {
  const root = mkdtempSync(join(tmpdir(), 'montagio-brand-gate-'));
  scratchRepos.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
};
afterAll(() => {
  for (const root of scratchRepos) rmSync(root, { recursive: true, force: true });
});

test('the gate rejects a legacy path', async () => {
  const path = `${legacy}-payload.txt`;
  expect(await findLegacyBrand(scratchRepo({ [path]: 'clean' }))).toEqual([`${path} (path)`]);
});

test('the gate rejects legacy content', async () => {
  expect(await findLegacyBrand(scratchRepo({ 'payload.bin': Buffer.from(['Shot', 'Rig'].join('')) }))).toEqual(['payload.bin (content)']);
});

test('the gate rejects an arbitrary mixed-case spelling', async () => {
  const mixedCase = legacy
    .split('')
    .map((letter, index) => (index % 2 === 0 ? letter : letter.toUpperCase()))
    .join('');
  expect(await findLegacyBrand(scratchRepo({ 'payload.txt': mixedCase }))).toEqual(['payload.txt (content)']);
});

test('the gate rejects a match spanning the chunk boundary', async () => {
  const payload = Buffer.concat([Buffer.alloc(chunkSize - 4, 120), Buffer.from(legacy.toUpperCase())]);
  expect(await findLegacyBrand(scratchRepo({ 'payload.bin': payload }))).toEqual(['payload.bin (content)']);
});

test('no tracked path or file contains the legacy brand', async () => {
  expect(await findLegacyBrand(repoRoot)).toEqual([]);
}, 60_000);
