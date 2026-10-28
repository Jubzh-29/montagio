import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const legacy = ['shot', 'rig'].join('');
const variants = [legacy, legacy.toUpperCase(), ['Shot', 'Rig'].join('')].map((variant) => Buffer.from(variant));
const overlap = Math.max(...variants.map((variant) => variant.length)) - 1;

test('no tracked path or file contains the legacy brand', async () => {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const violations: string[] = [];

  for (const path of paths) {
    if (path.toLowerCase().includes(legacy)) violations.push(`${path} (path)`);

    let tail = Buffer.alloc(0);
    let found = false;
    for await (const chunk of createReadStream(join(repoRoot, path), { highWaterMark: 64 * 1024 })) {
      const buffer = chunk as Buffer;
      const searchable = Buffer.concat([tail, buffer]);
      if (!found && variants.some((variant) => searchable.includes(variant))) {
        violations.push(`${path} (content)`);
        found = true;
      }
      tail = searchable.subarray(Math.max(0, searchable.length - overlap));
    }
  }

  expect(violations).toEqual([]);
}, 60_000);
