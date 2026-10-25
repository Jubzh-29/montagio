import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary } from '@montagio/presets';
import { AI_METADATA, probe, readTags } from '@montagio/sequence';
import { runCli } from '../src/cli';
import { IngestError, ingestHd } from '../src/ingest';
import { loadManifest } from '../src/manifest';
import { prepareShowcase } from '../src/prepare';
import { verifyShowcase } from '../src/verify';
import { hdWorkflow, showcaseJob, showcaseWorkflow, workflowSha256 } from '../src/workflow';
import { addExample, addRenderedClip, FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, repoRoot, sha256Of, showcasePath } from './helpers';

const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const raw480 = join(raws, 'a.mp4');
const raw480b = join(raws, 'b.mp4');
const raw1080 = join(raws, 'hd.mp4');
let root = '';
let upscale = '';
let inputs = '';
let renders = '';

type UpscaleRun = { input: string; size?: { width: number; height: number }; model?: string };

/**
 * A smoke.ts --extension upscale results folder: one record per run, naming its clip by the
 * name it loaded it, and listing that clip (as smoke.ts does) before the 1080p output.
 */
function writeUpscale(runs: UpscaleRun[]): void {
  mkdirSync(join(upscale, 'clips'), { recursive: true });
  const lines = runs.map((r, index) => {
    const stamp = `2026-10-24T12-00-0${index}-000Z__ext-upscale__seedvr2-upscale`;
    writeFileSync(join(upscale, 'clips', `${stamp}__r1.mp4`), readFileSync(raw480));
    writeFileSync(join(upscale, 'clips', `${stamp}__r1-1.mp4`), readFileSync(raw1080));
    return JSON.stringify({
      kind: 'extension',
      at: `2026-10-24T12:00:0${index}.000Z`,
      job: 'upscale',
      model: r.model ?? 'seedvr2-upscale',
      run: 1,
      status: 'succeeded',
      error: null,
      params: { ...(r.size ?? { width: 1920, height: 1080 }), seed: 42 },
      inputs: [r.input],
      image_sha256: null,
      outputs: [`clips/${stamp}__r1.mp4`, `clips/${stamp}__r1-1.mp4`],
    });
  });
  writeFileSync(join(upscale, 'smoke.jsonl'), `${lines.join('\n')}\n`);
}

/** A camera run of smoke.ts in the --renders folder, from landscape-a, with its own texts. */
async function writeCameraRun(preset: string, raw: string, texts: { description: string; negative: string }): Promise<void> {
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const { params } = showcaseJob(library, manifest, library.presets.get(preset)!, manifest.samples[0]!, 7, texts);
  mkdirSync(join(renders, 'clips'), { recursive: true });
  const output = `clips/2026-10-24T10-00-00-000Z__${preset}__wan22-i2v-a14b-fun-camera__r1.mp4`;
  copyFileSync(raw, join(renders, output));
  const record = {
    at: '2026-10-24T10:00:00.000Z',
    preset,
    model: 'wan22-i2v-a14b-fun-camera',
    run: 1,
    status: 'succeeded',
    camera: { mode: params.cameraMode, pose: params.cameraPose, pose_2: params.cameraPose2, combine: params.cameraCombine, speed: params.cameraSpeed },
    prompt: params.prompt,
    negative: params.negative,
    width: params.width,
    height: params.height,
    frames: params.frames,
    fps: params.fps,
    seed: 7,
    image: 'landscape-a.jpg',
    image_sha256: sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg')),
    outputs: [output],
  };
  writeFileSync(join(renders, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
}

/** The HD pass's model as data.json names it for the caption. */
const SEEDVR2 = { id: 'seedvr2-upscale', name: 'SeedVR2 3B (1080p upscale)', license: 'Apache-2.0' };

/** The open stack report prepare needs; returns where prepare writes the showcase. */
function writeReport(): string {
  const path = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ ok: true, checkedAt: '2026-10-24T12:00:00.000Z', models: [], violations: [] }));
  return join(root, 'apps', 'web', 'public', 'showcase');
}

const hdOf = async (input: string) => {
  const library = await loadLibrary(root);
  return workflowSha256(hdWorkflow(library, { model: 'seedvr2-upscale', input, seed: 42 }, '16:9'));
};

beforeAll(() => {
  rawRender(raw480, 'testsrc2');
  rawRender(raw480b, 'testsrc');
  rawRender(raw1080, 'testsrc2', 81, '1920x1080');
}, FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
  for (const folder of [(upscale = mkdtempSync(join(tmpdir(), 'montagio-hd-'))), (inputs = mkdtempSync(join(tmpdir(), 'montagio-inputs-'))), (renders = mkdtempSync(join(tmpdir(), 'montagio-renders-')))]) {
    mkdirSync(folder, { recursive: true });
  }
});
afterEach(() => {
  for (const folder of [root, upscale, inputs, renders]) removeRoot(folder);
});
afterAll(() => removeRoot(raws));

test('the HD pass of a showcase clip replaces its file, and its entry keeps the render it restored', async () => {
  const file = await addRenderedClip(root, raw480, 'crash-push');
  const before = (await loadManifest(root)).clips[0]!;
  const input = 'up--crash-push--landscape-a.mp4';
  copyFileSync(file, join(inputs, input));
  writeUpscale([{ input }]);

  expect(await ingestHd(root, upscale, { inputs, renders: [] })).toEqual({ added: [], replaced: ['clips/crash-push--landscape-a.mp4'], skipped: [] });
  const entry = (await loadManifest(root)).clips[0]!;
  expect(entry).toEqual({
    ...before,
    sha256: sha256Of(file),
    hd: { model: 'seedvr2-upscale', seed: 42, input, source_sha256: before.sha256, workflow_sha256: await hdOf(input), rendered_at: '2026-10-24' },
  });
  expect(await probe(file)).toMatchObject({ width: 1920, height: 1080, fps: 16 });
  expect(await readTags(file)).toMatchObject(AI_METADATA);
  expect((await verifyShowcase(root, { strict: false })).errors).toEqual([]);
  // The entry keeps the manifest's order: what it is, the file, the photo and workflow, then the pass.
  expect(readFileSync(showcasePath(root, 'manifest.yaml'), 'utf8')).toMatch(/^ {2}- \{ preset: crash-push, sample: landscape-a, seed: 42, sha256: [0-9a-f]{64}, image_sha256: .*, hd: \{ model: seedvr2-upscale, /m);

  // Ingested again, the pass is traced through the clip its entry remembers.
  expect(await ingestHd(root, upscale, { inputs, renders: [] })).toMatchObject({ replaced: ['clips/crash-push--landscape-a.mp4'], skipped: [] });

  // data.json names the pass's model, for the clip's caption (alone on its sample: no 480p placeholder to join).
  rmSync(join(root, 'presets', 'pan-left.yaml'));
  const data = await prepareShowcase(root, { outDir: writeReport(), strict: false, repoUrl: null });
  expect(data.clips).toEqual([expect.objectContaining({ preset: 'crash-push', placeholder: false, hd: SEEDVR2 })]);

  // A changed HD workflow is caught like a changed camera workflow: a warning, an error in strict mode.
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(entry.hd!.workflow_sha256, 'b'.repeat(64)));
  const changed = /^crash-push × landscape-a: the workflow of its HD pass changed since it was rendered/;
  expect((await verifyShowcase(root, { strict: false })).warnings).toContainEqual(expect.stringMatching(changed));
  expect((await verifyShowcase(root, { strict: true })).errors).toContainEqual(expect.stringMatching(changed));
}, FFMPEG_TIMEOUT_MS * 2);

test('the HD pass of a camera run of --renders writes the entry from that run, its texts included', async () => {
  const texts = { description: 'a quiet harbour at dawn. The boat stays solid and still', negative: 'blurry, transparent boat, ghosting' };
  await writeCameraRun('pan-left', raw480b, texts);
  const input = 'new--pan-left--landscape-a.mp4';
  copyFileSync(raw480b, join(inputs, input));
  writeUpscale([{ input }]);

  expect(await ingestHd(root, upscale, { inputs, renders: [renders] })).toEqual({ added: ['clips/pan-left--landscape-a.mp4'], replaced: [], skipped: [] });
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const workflow = showcaseWorkflow(library, manifest, library.presets.get('pan-left')!, manifest.samples[0]!, 7, texts);
  const file = showcasePath(root, 'clips', 'pan-left--landscape-a.mp4');
  expect(manifest.clips).toEqual([
    {
      preset: 'pan-left',
      sample: 'landscape-a',
      seed: 7,
      ...texts,
      sha256: sha256Of(file),
      image_sha256: sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg')),
      workflow_sha256: workflowSha256(workflow),
      rendered_at: '2026-10-24',
      hd: { model: 'seedvr2-upscale', seed: 42, input, source_sha256: sha256Of(raw480b), workflow_sha256: await hdOf(input), rendered_at: '2026-10-24' },
    },
  ]);
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toEqual([]);
  expect(report.warnings.filter((line) => /workflow/.test(line))).toEqual([]);
}, FFMPEG_TIMEOUT_MS * 2);

test('the HD pass of an effect example replaces its file and keeps its workflow', async () => {
  for (const folder of ['effects', 'transitions']) cpSync(join(repoRoot, 'presets', folder), join(root, 'presets', folder), { recursive: true });
  const file = await addExample(root, raw480, 'effect', 'squish');
  const before = (await loadManifest(root)).effects[0]!;
  copyFileSync(file, join(inputs, 'up--fx-squish--landscape-a.mp4'));
  writeUpscale([{ input: 'up--fx-squish--landscape-a.mp4' }]);

  expect(await ingestHd(root, upscale, { inputs, renders: [] })).toMatchObject({ replaced: ['effects/squish--landscape-a.mp4'], skipped: [] });
  expect((await loadManifest(root)).effects[0]).toEqual({ ...before, sha256: sha256Of(file), hd: expect.objectContaining({ source_sha256: before.sha256 }) });
  expect(await probe(file)).toMatchObject({ width: 1920, height: 1080, fps: 16 });
  expect((await verifyShowcase(root, { strict: false })).errors).toEqual([]);
  const data = await prepareShowcase(root, { outDir: writeReport(), strict: false, repoUrl: null });
  expect(data.effects.find((item) => item.id === 'squish')?.examples).toEqual([expect.objectContaining({ sample: 'landscape-a', hd: SEEDVR2 })]);
}, FFMPEG_TIMEOUT_MS * 2);

test('skips a pass it cannot trace to a render, a withheld render and another size; refuses a clip upscaled twice', async () => {
  const file = await addRenderedClip(root, raw480, 'crash-push');
  copyFileSync(file, join(inputs, 'up--crash-push--landscape-a.mp4'));
  copyFileSync(raw480b, join(inputs, 'stranger.mp4'));
  await writeCameraRun('pan-left', raw480b, { description: 'a harbour', negative: 'blurry' });
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}withheld:\n  - { preset: pan-left, sample: landscape-a, reason: 'a test of the list' }\n`);
  writeUpscale([
    { input: 'missing.mp4' },
    { input: 'stranger.mp4' },
    { input: 'up--crash-push--landscape-a.mp4', size: { width: 1280, height: 720 } },
  ]);
  // stranger.mp4 is the pan-left run's output, but that render is withheld.
  const result = await ingestHd(root, upscale, { inputs, renders: [renders] });
  expect(result.added).toEqual([]);
  expect(result.replaced).toEqual([]);
  expect(result.skipped).toEqual([
    `upscale of missing.mp4: no missing.mp4 in ${inputs}, so it cannot be traced to a render`,
    'upscale of stranger.mp4 (pan-left × landscape-a): withheld from the showcase (a test of the list)',
    'upscale of up--crash-push--landscape-a.mp4 (crash-push × landscape-a): rendered at 1280x720; the HD pass makes 1920x1080 for landscape-a',
  ]);
  expect(await ingestHd(root, upscale, { inputs, renders: [] })).toMatchObject({
    skipped: expect.arrayContaining(['upscale of stranger.mp4: its clip is neither a render of the showcase nor the output of a camera run of --renders']),
  });

  writeUpscale([{ input: 'up--crash-push--landscape-a.mp4' }, { input: 'up--crash-push--landscape-a.mp4' }]);
  const error = await ingestHd(root, upscale, { inputs, renders: [] }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(IngestError);
  expect((error as IngestError).problems).toEqual([expect.stringMatching(/^clip crash-push × landscape-a: upscaled twice in .*; ingest the folder of the pass to keep alone$/)]);
}, FFMPEG_TIMEOUT_MS * 2);

test('the command line: --hd takes one folder and --inputs, and no --sample', async () => {
  const file = await addRenderedClip(root, raw480, 'crash-push');
  copyFileSync(file, join(inputs, 'up--crash-push--landscape-a.mp4'));
  writeUpscale([{ input: 'up--crash-push--landscape-a.mp4' }]);
  const out: string[] = [];
  const io = { root, out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
  expect(await runCli(['ingest', '--hd', upscale], io)).toBe(2);
  expect(await runCli(['ingest', '--hd', upscale, '--inputs', inputs, '--sample', 'landscape-a'], io)).toBe(2);
  expect(await runCli(['ingest', upscale, '--sample', 'landscape-a', '--inputs', inputs], io)).toBe(2);
  expect(await runCli(['ingest', '--hd', upscale, '--inputs', inputs], io)).toBe(0);
  expect(out).toContain('replaced: clips/crash-push--landscape-a.mp4');
  expect(out).toContain('showcase: 1 HD file ingested; run "showcase verify" next');
}, FFMPEG_TIMEOUT_MS * 2);
