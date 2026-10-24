import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_METADATA, probe, readTags } from '@montagio/sequence';
import { runCli } from '../src/cli';
import { ingestExamples } from '../src/ingest';
import { loadManifest } from '../src/manifest';
import { workflowSha256 } from '../src/workflow';
import { FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, repoRoot, sha256Of, showcasePath } from './helpers';

const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const raw = join(raws, 'effect.mp4');
let root = '';
let smoke = '';

type ExampleRun = { job: string; model: string; seed?: number; imageSha?: string; status?: string; size?: { width: number; height: number } };

/** A smoke.ts results folder of extension jobs: one record per run, its clip under clips/, its workflow under workflows/. */
function writeSmoke(runs: ExampleRun[]): void {
  const sampleSha = sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg'));
  mkdirSync(join(smoke, 'clips'), { recursive: true });
  mkdirSync(join(smoke, 'workflows'), { recursive: true });
  const lines = runs.map((r, index) => {
    const tag = `ext-${r.job.replace(':', '-')}__${r.model}`;
    const output = `clips/2026-10-24T11-00-0${index}-000Z__${r.job}__r1.mp4`;
    writeFileSync(join(smoke, output), readFileSync(raw));
    writeFileSync(join(smoke, 'workflows', `${tag}.api.json`), JSON.stringify({ '1': { class_type: 'Marker', inputs: { job: r.job } } }));
    return JSON.stringify({
      kind: 'extension',
      at: `2026-10-24T11:00:0${index}.000Z`,
      job: r.job,
      model: r.model,
      run: 1,
      status: r.status ?? 'succeeded',
      error: null,
      params: { ...(r.size ?? { width: 832, height: 480 }), frames: 81, seed: r.seed ?? 42, fast: true },
      inputs: ['landscape-a.jpg'],
      outputs: [output],
      image_sha256: r.imageSha ?? sampleSha,
    });
  });
  writeFileSync(join(smoke, 'smoke.jsonl'), `${lines.join('\n')}\n`);
}

beforeAll(() => rawRender(raw), FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
  for (const kind of ['effects', 'transitions']) cpSync(join(repoRoot, 'presets', kind), join(root, 'presets', kind), { recursive: true });
  smoke = mkdtempSync(join(tmpdir(), 'montagio-smoke-'));
});
afterEach(() => {
  removeRoot(root);
  removeRoot(smoke);
});
afterAll(() => removeRoot(raws));

test('ingest takes the successful effect and transition runs made from the sample photo', async () => {
  writeSmoke([
    { job: 'effect:squish', model: 'wan21-i2v-effects', seed: 42 },
    { job: 'hook-edit:iris-dive', model: 'qwen-image-edit-2511' },
    { job: 'transition:iris-dive', model: 'wan22-flf2v-transition', seed: 43 },
  ]);
  const result = await ingestExamples(root, smoke, 'landscape-a', {});
  expect(result).toEqual({ added: ['effects/squish--landscape-a.mp4', 'hooks/iris-dive--landscape-a.mp4'], replaced: [], skipped: [] });

  const manifest = await loadManifest(root);
  const clip = showcasePath(root, 'effects', 'squish--landscape-a.mp4');
  const workflow = JSON.parse(readFileSync(showcasePath(root, 'workflows', 'effect-squish--landscape-a.json'), 'utf8'));
  expect(manifest.effects).toEqual([
    {
      effect: 'squish',
      sample: 'landscape-a',
      seed: 42,
      sha256: sha256Of(clip),
      image_sha256: sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg')),
      workflow_sha256: workflowSha256(workflow),
      rendered_at: '2026-10-24',
    },
  ]);
  expect(manifest.hooks).toMatchObject([{ hook: 'iris-dive', sample: 'landscape-a', seed: 43 }]);
  expect(await readTags(clip)).toMatchObject(AI_METADATA);
  expect(await probe(clip)).toMatchObject({ width: 832, height: 480, fps: 16 });
}, FFMPEG_TIMEOUT_MS);

test('a run made from another photo is skipped, and says why', async () => {
  writeSmoke([
    { job: 'effect:squish', model: 'wan21-i2v-effects', imageSha: 'b'.repeat(64) },
    { job: 'effect:karaoke', model: 'wan21-i2v-effects' },
    { job: 'effect:explode', model: 'wan21-i2v-effects', size: { width: 1280, height: 720 } },
  ]);
  const result = await ingestExamples(root, smoke, 'landscape-a', {});
  expect(result.added).toEqual([]);
  expect(result.skipped).toEqual([
    'effect:squish run 1: made from another image, not samples/landscape-a.jpg',
    'effect:karaoke run 1: "karaoke" is not an effect of the library',
    'effect:explode run 1: rendered at 1280x720; the showcase shows 832x480 for landscape-a',
  ]);
}, FFMPEG_TIMEOUT_MS);

test('a withheld example is skipped: a run of it again does not bring it back', async () => {
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}withheld:\n  - { effect: squish, sample: landscape-a, reason: 'hands crush a person' }\n`);
  writeSmoke([
    { job: 'effect:squish', model: 'wan21-i2v-effects' },
    { job: 'effect:explode', model: 'wan21-i2v-effects' },
  ]);
  const result = await ingestExamples(root, smoke, 'landscape-a', {});
  expect(result.added).toEqual(['effects/explode--landscape-a.mp4']);
  expect(result.skipped).toEqual(['effect:squish run 1: withheld from the showcase on landscape-a (hands crush a person)']);
  expect((await loadManifest(root)).effects.map((entry) => entry.effect)).toEqual(['explode']);
}, FFMPEG_TIMEOUT_MS);

test('--pick does not apply to examples: one smoke folder per call instead', async () => {
  writeSmoke([{ job: 'effect:squish', model: 'wan21-i2v-effects' }]);
  const out: string[] = [];
  const io = { root, out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
  expect(await runCli(['ingest', '--examples', smoke, '--sample', 'landscape-a', '--pick', 'effect:squish=1'], io)).toBe(2);
  expect(out.join('\n')).toMatch(/one --out folder per smoke call/);
  expect(await runCli(['ingest', '--examples', smoke, '--sample', 'landscape-a'], io)).toBe(0);
}, FFMPEG_TIMEOUT_MS);
