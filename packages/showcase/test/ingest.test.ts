import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary } from '@montagio/presets';
import { AI_METADATA, probe, readTags } from '@montagio/sequence';
import { IngestError, ingestSmoke } from '../src/ingest';
import { loadManifest } from '../src/manifest';
import { verifyShowcase } from '../src/verify';
import { showcaseJob, showcaseWorkflow, workflowSha256 } from '../src/workflow';
import { FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, sha256Of, showcasePath } from './helpers';

const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const rawA = join(raws, 'a.mp4');
const rawB = join(raws, 'b.mp4');
let root = '';
let smoke = '';

/** The camera smoke.ts records for each preset on Fun Camera (CompiledParams). */
const CAMERA: Record<string, object> = {
  'crash-push': { mode: 'parametric', pose: 'Zoom In', pose_2: null, combine: null, speed: 1.5 },
  'pan-left': { mode: 'parametric', pose: 'Pan Left', pose_2: null, combine: null, speed: 1 },
};

type Run = {
  preset: string;
  run?: number;
  seed?: number;
  raw?: string;
  model?: string;
  imageSha?: string;
  camera?: object;
  status?: string;
  /** What smoke.ts compiled: the preset's 832x480, 81 frames at 16 fps unless overridden. */
  size?: { width: number; height: number; frames: number; fps: number };
  /** The text the model got: the showcase's for the preset on landscape-a unless overridden. */
  prompt?: string;
};

/** The text the showcase compiles for `preset` on landscape-a: the photo's, when the manifest has one, then the preset's. */
async function showcasePrompt(preset: string, withPhotoText = true): Promise<string> {
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const sample = manifest.samples[0]!;
  return showcaseJob(library, manifest, library.presets.get(preset)!, withPhotoText ? sample : { ...sample, prompt: undefined }, 42).params.prompt;
}

/** Write a smoke.ts results folder: one record per run, its clip under clips/. */
async function writeSmoke(runs: Run[]): Promise<void> {
  const sampleSha = sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg'));
  mkdirSync(join(smoke, 'clips'), { recursive: true });
  const prompts = await Promise.all(runs.map((r) => r.prompt ?? showcasePrompt(r.preset)));
  const lines = runs.map((r, index) => {
    const output = `clips/2026-10-24T10-00-0${index}-000Z__${r.preset}__r${r.run ?? 1}.mp4`;
    writeFileSync(join(smoke, output), readFileSync(r.raw ?? rawA));
    return JSON.stringify({
      at: `2026-10-24T10:00:0${index}.000Z`,
      preset: r.preset,
      model: r.model ?? 'wan22-i2v-a14b-fun-camera',
      run: r.run ?? 1,
      status: r.status ?? 'succeeded',
      error: null,
      camera: r.camera ?? CAMERA[r.preset],
      ...(r.size ?? { width: 832, height: 480, frames: 81, fps: 16 }),
      duration_s: 5,
      seed: r.seed ?? 42,
      prompt: prompts[index],
      outputs: [output],
      image: 'landscape-a.jpg',
      image_sha256: r.imageSha ?? sampleSha,
    });
  });
  writeFileSync(join(smoke, 'smoke.jsonl'), `${lines.join('\n')}\n`);
}

beforeAll(() => {
  rawRender(rawA, 'testsrc2');
  rawRender(rawB, 'testsrc');
}, FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
  smoke = mkdtempSync(join(tmpdir(), 'montagio-smoke-'));
});
afterEach(() => {
  removeRoot(root);
  removeRoot(smoke);
});
afterAll(() => removeRoot(raws));

test('ingests the succeeded runs of the sample and writes the manifest entries', async () => {
  await writeSmoke([{ preset: 'crash-push', seed: 42 }, { preset: 'pan-left', seed: 43, raw: rawB }]);
  const result = await ingestSmoke(root, smoke, 'landscape-a', {});
  expect(result).toEqual({
    added: ['clips/crash-push--landscape-a.mp4', 'clips/pan-left--landscape-a.mp4'],
    replaced: [],
    skipped: [],
  });

  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const file = showcasePath(root, 'clips', 'crash-push--landscape-a.mp4');
  const workflow = showcaseWorkflow(library, manifest, library.presets.get('crash-push')!, manifest.samples[0]!, 42);
  expect(manifest.clips[0]).toEqual({
    preset: 'crash-push',
    sample: 'landscape-a',
    seed: 42,
    sha256: sha256Of(file),
    image_sha256: sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg')),
    workflow_sha256: workflowSha256(workflow),
    rendered_at: '2026-10-24',
  });
  expect(manifest.clips[1]).toMatchObject({ preset: 'pan-left', seed: 43 });
  expect(await readTags(file)).toMatchObject(AI_METADATA);
  expect(await probe(file)).toMatchObject({ width: 832, height: 480, fps: 16 });
  // What ingest writes is what verify accepts.
  expect((await verifyShowcase(root, { strict: false })).errors).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('refuses two runs of one preset until --pick chooses', async () => {
  await writeSmoke([
    { preset: 'crash-push', run: 1, seed: 42 },
    { preset: 'crash-push', run: 2, seed: 43, raw: rawB },
  ]);
  const error = await ingestSmoke(root, smoke, 'landscape-a', {}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(IngestError);
  const problems = (error as IngestError).problems.join('\n');
  expect(problems).toMatch(/crash-push: 2 successful runs, choose one with --pick crash-push=<run>/);
  expect(problems).toMatch(/run 1, seed 42, clips\/.*__r1\.mp4/);
  expect(problems).toMatch(/run 2, seed 43, clips\/.*__r2\.mp4/);
  expect((await loadManifest(root)).clips).toEqual([]);

  await ingestSmoke(root, smoke, 'landscape-a', { 'crash-push': 2 });
  expect((await loadManifest(root)).clips).toEqual([expect.objectContaining({ preset: 'crash-push', seed: 43 })]);
}, FFMPEG_TIMEOUT_MS);

test('skips a run made from another image, another model or a camera sweep', async () => {
  await writeSmoke([
    { preset: 'crash-push', imageSha: 'f'.repeat(64) },
    { preset: 'crash-push', model: 'wan22-ti2v-5b' },
    { preset: 'crash-push', camera: { ...CAMERA['crash-push'], pose: 'Pan Right' } },
    { preset: 'pan-left', status: 'error' },
  ]);
  const result = await ingestSmoke(root, smoke, 'landscape-a', {});
  expect(result.added).toEqual([]);
  expect(result.skipped).toEqual([
    expect.stringMatching(/^crash-push run 1: made from another image/),
    expect.stringMatching(/^crash-push run 1: rendered on wan22-ti2v-5b, the showcase shows wan22-i2v-a14b-fun-camera/),
    expect.stringMatching(/^crash-push run 1: its camera .* is not the preset's/),
  ]);
  expect((await loadManifest(root)).clips).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('skips a run rendered at another size or length than the preset makes for the sample', async () => {
  await writeSmoke([
    // smoke.ts --resolution 720p
    { preset: 'crash-push', size: { width: 1280, height: 720, frames: 81, fps: 16 } },
    { preset: 'pan-left', size: { width: 832, height: 480, frames: 49, fps: 16 } },
  ]);
  const result = await ingestSmoke(root, smoke, 'landscape-a', {});
  expect(result.added).toEqual([]);
  expect(result.skipped).toEqual([
    'crash-push run 1: rendered at 1280x720, 81 frames at 16 fps; the preset makes 832x480, 81 frames at 16 fps for landscape-a',
    'pan-left run 1: rendered at 832x480, 49 frames at 16 fps; the preset makes 832x480, 81 frames at 16 fps for landscape-a',
  ]);
  expect((await loadManifest(root)).clips).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('a photo with a text: a run is kept only when the model got that text before the preset', async () => {
  const manifestFile = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestFile, readFileSync(manifestFile, 'utf8').replace('    status: placeholder\n', '    status: placeholder\n    prompt: a quiet harbour at dawn, fishing boats\n'));
  // smoke.ts without --prompt: the model got the preset's text alone.
  const bare = await showcasePrompt('pan-left', false);
  await writeSmoke([{ preset: 'crash-push' }, { preset: 'pan-left', prompt: bare }]);
  const result = await ingestSmoke(root, smoke, 'landscape-a', {});
  expect(result.added).toEqual(['clips/crash-push--landscape-a.mp4']);
  expect(result.skipped).toEqual([
    `pan-left run 1: rendered from the text ${JSON.stringify(bare)}; the showcase compiles ${JSON.stringify(await showcasePrompt('pan-left'))} for landscape-a`,
  ]);
  expect(await showcasePrompt('crash-push')).toMatch(/^a quiet harbour at dawn, fishing boats, /);
  // The workflow the manifest vouches for, the one "Open in ComfyUI" hands out, carries the photo's text.
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const workflow = showcaseWorkflow(library, manifest, library.presets.get('crash-push')!, manifest.samples[0]!, 42);
  expect(JSON.stringify(workflow)).toContain('a quiet harbour at dawn, fishing boats');
  expect(manifest.clips[0]).toMatchObject({ preset: 'crash-push', workflow_sha256: workflowSha256(workflow) });
  expect((await verifyShowcase(root, { strict: false })).errors).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('keeps the comments of the manifest and replaces an entry ingested again', async () => {
  await writeSmoke([{ preset: 'crash-push', seed: 42 }]);
  await ingestSmoke(root, smoke, 'landscape-a', {});
  await writeSmoke([{ preset: 'crash-push', seed: 77, raw: rawB }]);
  const again = await ingestSmoke(root, smoke, 'landscape-a', {});
  expect(again).toMatchObject({ added: [], replaced: ['clips/crash-push--landscape-a.mp4'] });
  const text = readFileSync(showcasePath(root, 'manifest.yaml'), 'utf8');
  expect(text).toContain('# The model every rendered clip was made with.');
  expect((await loadManifest(root)).clips).toEqual([expect.objectContaining({ preset: 'crash-push', seed: 77 })]);
}, FFMPEG_TIMEOUT_MS);

test('refuses an unknown sample and a folder without smoke.jsonl', async () => {
  await expect(ingestSmoke(root, smoke, 'nowhere', {})).rejects.toThrow(/unknown sample "nowhere"/);
  await expect(ingestSmoke(root, smoke, 'landscape-a', {})).rejects.toThrow(/smoke\.jsonl/);
});
