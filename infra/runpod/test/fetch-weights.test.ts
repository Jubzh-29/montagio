import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLock } from '@montagio/registry';
import { parseHfUrl } from '../lib/weights';

const runpodDir = fileURLToPath(new URL('../', import.meta.url));
const offline = new URL('./fixtures/hf-offline.ts', import.meta.url).href;
const lock = parseLock(readFileSync(new URL('../../../registry/models.lock.yaml', import.meta.url), 'utf8'), 'registry/models.lock.yaml');

/**
 * What Hugging Face's API answers for these lock entries: an LFS file with the sha256 of its
 * object, a file kept out of LFS with its git blob id only (the Chatterbox tokenizer table).
 */
function hfAnswers(ids: string[], gitSha1 = (pinned: string) => pinned): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  const trees = new Map<string, unknown[]>();
  for (const id of ids) {
    const entry = lock.find((e) => e.id === id)!;
    const { repo, path } = parseHfUrl(entry.url);
    const file = entry.git_sha1
      ? { type: 'file', path, size: entry.size, oid: gitSha1(entry.git_sha1) }
      : { type: 'file', path, size: entry.size, oid: '0'.repeat(40), lfs: { oid: entry.sha256, size: entry.size } };
    trees.set(repo, [...(trees.get(repo) ?? []), file]);
    for (const card of [repo, parseHfUrl(entry.source).repo]) {
      answers[`https://huggingface.co/api/models/${card}`] = { sha: 'a'.repeat(40), cardData: { license: entry.license.toLowerCase() } };
    }
  }
  for (const [repo, files] of trees) answers[`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`] = files;
  return answers;
}

function lockFromHf(ids: string[], answers: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-weights-'));
  writeFileSync(join(dir, 'hf.json'), JSON.stringify(answers));
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--import', offline, 'fetch-weights.ts', '--lock-from-hf', '--only', ids.join(','), '--out', join(dir, 'out')],
    { cwd: runpodDir, encoding: 'utf8', env: { ...process.env, MONTAGIO_HF_ANSWERS: join(dir, 'hf.json'), HF_TOKEN: '' } },
  );
  return { ...run, patch: () => readFileSync(join(dir, 'out', 'models.lock.patch'), 'utf8') };
}

const ids = ['chatterbox-conds', 'chatterbox-grapheme-mtl'];

test('--lock-from-hf on a lock Hugging Face still serves ends in 0 with an empty patch, a file kept out of LFS included', () => {
  const run = lockFromHf(ids, hfAnswers(ids));
  expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
  expect(run.patch()).toBe('');
  expect(run.stdout).toMatch(/lock patch: empty, the lock already pins these 2 entries/);
  expect(run.stdout).not.toMatch(/git apply/);
}, 60_000);

test('--lock-from-hf ends in 1 when the git blob of a file kept out of LFS changed upstream', () => {
  const run = lockFromHf(ids, hfAnswers(ids, () => 'e'.repeat(40)));
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/chatterbox-grapheme-mtl: the file changed upstream: lock pins git blob d27fb3f2/);
}, 60_000);
