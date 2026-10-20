import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareShowcase } from '../src/prepare';
import { verifyShowcase } from '../src/verify';
import { addExample, FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, sha256Of, showcasePath } from './helpers';

const PREPARE_TIMEOUT_MS = 180_000;
const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const raw = join(raws, 'a.mp4');
let root = '';

beforeAll(() => rawRender(raw), FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
  const report = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
  mkdirSync(join(report, '..'), { recursive: true });
  writeFileSync(report, JSON.stringify({ ok: true, checkedAt: '2026-10-18T20:00:00.000Z', models: [], violations: [] }));
});
afterEach(() => removeRoot(root));
afterAll(() => rmSync(raws, { recursive: true, force: true }));

test('verify accepts an example as ingest writes it, and reports one whose clip changed', async () => {
  const clip = await addExample(root, raw, 'effect', 'squish');
  expect((await verifyShowcase(root, { strict: false })).errors).toEqual([]);
  appendFileSync(clip, 'x');
  expect((await verifyShowcase(root, { strict: false })).errors).toContainEqual(expect.stringMatching(/^effects\/squish--landscape-a\.mp4: sha256 is /));
}, FFMPEG_TIMEOUT_MS);

test('verify reports an example file without a manifest entry, and an example workflow that changed', async () => {
  await addExample(root, raw, 'hook', 'iris-dive');
  writeFileSync(showcasePath(root, 'hooks', 'stray.mp4'), 'x');
  writeFileSync(showcasePath(root, 'workflows', 'hook-iris-dive--landscape-a.json'), '{}\n');
  const { errors } = await verifyShowcase(root, { strict: false });
  expect(errors).toContainEqual('hooks/stray.mp4: no manifest entry');
  expect(errors).toContainEqual('workflows/hook-iris-dive--landscape-a.json: the workflow changed since it was ingested (workflow_sha256 differs)');
}, FFMPEG_TIMEOUT_MS);

test('prepare lists only the effects that have an example, with their samples', async () => {
  await addExample(root, raw, 'effect', 'squish');
  await addExample(root, raw, 'hook', 'iris-dive', 43);
  const out = join(root, 'apps', 'web', 'public', 'showcase');
  const data = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  expect(data.effects).toEqual([
    {
      id: 'squish',
      name: 'Squish',
      description: expect.any(String),
      modelId: 'wan21-i2v-effects',
      modelName: expect.stringMatching(/Wan 2.1/),
      license: 'Apache-2.0',
      examples: [{ sample: 'landscape-a', url: 'effects/squish--landscape-a.mp4', workflowUrl: 'workflows/effect-squish--landscape-a.json' }],
    },
  ]);
  expect(data.hooks).toEqual([expect.objectContaining({ id: 'iris-dive', references: 1, examples: [expect.objectContaining({ sample: 'landscape-a', url: 'hooks/iris-dive--landscape-a.mp4' })] })]);
  expect(sha256Of(join(out, 'effects', 'squish--landscape-a.mp4'))).toBe(sha256Of(showcasePath(root, 'effects', 'squish--landscape-a.mp4')));
  expect(existsSync(join(out, 'workflows', 'hook-iris-dive--landscape-a.json'))).toBe(true);
}, PREPARE_TIMEOUT_MS);

test('prepare keeps the text of a sample', async () => {
  const manifest = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('    status: placeholder\n', '    status: placeholder\n    prompt: a quiet harbour at dawn\n'));
  const data = await prepareShowcase(root, { outDir: join(root, 'out'), strict: false, repoUrl: null });
  expect(data.samples[0]!.prompt).toBe('a quiet harbour at dawn');
  expect(data.effects).toEqual([]);
  expect(data.hooks).toEqual([]);
}, PREPARE_TIMEOUT_MS);
