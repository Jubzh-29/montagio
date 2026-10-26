import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary } from '@montagio/presets';
import { AI_METADATA, probe, probeAudio, readTags } from '@montagio/sequence';
import { FeatureError, ingestFeature } from '../src/features';
import { loadManifest, ManifestError, parseManifest } from '../src/manifest';
import { prepareShowcase } from '../src/prepare';
import { verifyShowcase } from '../src/verify';
import { hdWorkflow } from '../src/workflow';
import { FFMPEG_TIMEOUT_MS, makeRoot, ONE_SAMPLE_MANIFEST, rawRender, removeRoot, sha256Of, showcasePath } from './helpers';

/** Real FFmpeg, a 1080x1920 encode among them. */
const INGEST_TIMEOUT_MS = 180_000;
let root = '';
let runs = '';

beforeEach(() => {
  root = makeRoot();
  runs = mkdtempSync(join(tmpdir(), 'montagio-feature-runs-'));
});
afterEach(() => {
  removeRoot(root);
  rmSync(runs, { recursive: true, force: true });
});

const photoOf = (dir: string) => {
  const path = join(dir, 'pip.jpg');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280', '-frames:v', '1', path]);
  return path;
};

/** What smoke.ts leaves for `--extension motion`: the prepared clip, the echo and the result, the workflow, the record. */
function motionRun(dir: string, photo: string, frames = 33): string {
  mkdirSync(join(dir, 'clips'), { recursive: true });
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  mkdirSync(join(dir, 'workflows'), { recursive: true });
  rawRender(join(dir, 'inputs', 'motion.mp4'), 'testsrc2', frames, '480x832');
  rawRender(join(dir, 'clips', 'x__ext-motion__wan-animate2-motion__r1.mp4'), 'testsrc2', frames, '480x832');
  rawRender(join(dir, 'clips', 'x__ext-motion__wan-animate2-motion__r1-1.mp4'), 'smptebars', frames, '480x832');
  writeFileSync(join(dir, 'workflows', 'ext-motion__wan-animate2-motion.api.json'), JSON.stringify({ '1': { class_type: 'Marker', inputs: { job: 'motion' } } }));
  const record = {
    kind: 'extension',
    at: '2026-10-26T22:00:00.000Z',
    job: 'motion',
    model: 'wan-animate2-motion',
    run: 1,
    status: 'succeeded',
    params: { width: 480, height: 832, frames, seed: 42 },
    inputs: ['pip.jpg', 'motion.mp4'],
    outputs: ['clips/x__ext-motion__wan-animate2-motion__r1.mp4', 'clips/x__ext-motion__wan-animate2-motion__r1-1.mp4'],
    image_sha256: sha256Of(photo),
  };
  writeFileSync(join(dir, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
  return dir;
}

/** What smoke.ts leaves for `--extension upscale --clip <name> --smooth`, and the folder of the clip it loaded. */
async function hdRun(dir: string, rendered: string, name: string, frames = 33): Promise<{ dir: string; inputs: string }> {
  const inputs = join(dir, 'volume-inputs');
  mkdirSync(join(dir, 'clips'), { recursive: true });
  mkdirSync(join(dir, 'workflows'), { recursive: true });
  mkdirSync(inputs, { recursive: true });
  copyFileSync(rendered, join(inputs, name));
  copyFileSync(rendered, join(dir, 'clips', 'y__ext-upscale__seedvr2-upscale__r1.mp4'));
  rawRender(join(dir, 'clips', 'y__ext-upscale__seedvr2-upscale__r1-1.mp4'), 'testsrc2', frames * 2 - 1, '1080x1920');
  const workflow = hdWorkflow(await loadLibrary(root), { model: 'seedvr2-upscale', input: name, seed: 42, smooth: true }, '9:16');
  writeFileSync(join(dir, 'workflows', 'ext-upscale__seedvr2-upscale.api.json'), JSON.stringify(workflow));
  const record = {
    kind: 'extension',
    at: '2026-10-26T23:00:00.000Z',
    job: 'upscale',
    model: 'seedvr2-upscale',
    run: 1,
    status: 'succeeded',
    params: { width: 1080, height: 1920, seed: 42, smooth: true },
    inputs: [name],
    outputs: ['clips/y__ext-upscale__seedvr2-upscale__r1.mp4', 'clips/y__ext-upscale__seedvr2-upscale__r1-1.mp4'],
    image_sha256: null,
  };
  writeFileSync(join(dir, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
  return { dir, inputs };
}

const entryOf = (text: string) => `${ONE_SAMPLE_MANIFEST}features:\n  - ${text}\n`;
const SHA = 'a'.repeat(64);
const STEP = `steps: [{ model: wan-animate2-motion, workflow_sha256: ${SHA} }]`;

test('a feature example names the example it was made from, and a translation its language', () => {
  const motion = `{ id: pip-dance, feature: motion, aspect: '9:16', seed: 42, ${STEP}, sha256: ${SHA}, rendered_at: 2026-10-26 }`;
  expect(parseManifest(entryOf(motion), 'm').features).toHaveLength(1);
  const translate = `{ id: avatar-zh, feature: translate, aspect: '16:9', seed: 42, ${STEP}, sha256: ${SHA}, rendered_at: 2026-10-26 }`;
  expect(() => parseManifest(entryOf(translate), 'm')).toThrow(ManifestError);
  expect(() => parseManifest(entryOf(`${motion}\n  - ${motion}`), 'm')).toThrow(/duplicate feature example/);
  const elsewhere = `{ id: pip-dance, feature: motion, aspect: '9:16', seed: 42, inputs: [{ role: photo, file: features/inputs/other--photo.jpg, sha256: ${SHA} }], ${STEP}, sha256: ${SHA}, rendered_at: 2026-10-26 }`;
  expect(() => parseManifest(entryOf(elsewhere), 'm')).toThrow(/features\/inputs\/pip-dance--/);
});

test('a motion example comes in with its photo, its reference clip, its workflow and its smooth HD pass', async () => {
  const photo = photoOf(runs);
  const render = motionRun(join(runs, 'render'), photo);
  const hd = await hdRun(join(runs, 'hd'), join(render, 'clips', 'x__ext-motion__wan-animate2-motion__r1-1.mp4'), 'vit-motion-pip.mp4');
  const result = await ingestFeature(root, { id: 'pip-dance', kind: 'motion', render, photo, face: 'pip', hd });
  expect(result.added).toEqual(['features/pip-dance.mp4']);

  const entry = (await loadManifest(root)).features[0]!;
  expect(entry).toMatchObject({ id: 'pip-dance', feature: 'motion', aspect: '9:16', seed: 42, face: 'pip', hd: { model: 'seedvr2-upscale', smooth: true, input: 'vit-motion-pip.mp4' } });
  expect(entry.inputs.map((input) => input.role)).toEqual(['photo', 'clip']);
  const file = showcasePath(root, 'features', 'pip-dance.mp4');
  expect(await probe(file)).toMatchObject({ width: 1080, height: 1920, fps: 32, codec: 'h264' });
  expect(await readTags(file)).toMatchObject(AI_METADATA);
  expect(sha256Of(showcasePath(root, 'features', 'inputs', 'pip-dance--photo.jpg'))).toBe(sha256Of(photo));
  expect(existsSync(showcasePath(root, 'workflows', 'feature-pip-dance--1-wan-animate2-motion.json'))).toBe(true);

  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toEqual([]);
  // A file changed afterwards, and a stray one, are caught.
  writeFileSync(showcasePath(root, 'features', 'inputs', 'pip-dance--clip.mp4'), 'not the clip');
  writeFileSync(showcasePath(root, 'features', 'stray.mp4'), 'stray');
  const tampered = await verifyShowcase(root, { strict: false });
  expect(tampered.errors).toContain(`features/inputs/pip-dance--clip.mp4: sha256 is ${sha256Of(showcasePath(root, 'features', 'inputs', 'pip-dance--clip.mp4'))}, the manifest says ${entry.inputs[1]!.sha256}`);
  expect(tampered.errors).toContain('features/stray.mp4: no manifest entry');
}, INGEST_TIMEOUT_MS);

test('an HD pass of another clip, or a motion example without its photo, is refused', async () => {
  const photo = photoOf(runs);
  const render = motionRun(join(runs, 'render'), photo);
  const other = join(runs, 'other.mp4');
  rawRender(other, 'smptebars', 20, '480x832');
  const hd = await hdRun(join(runs, 'hd'), other, 'other.mp4');
  await expect(ingestFeature(root, { id: 'pip-dance', kind: 'motion', render, photo, hd })).rejects.toThrow(/is not .*r1-1\.mp4/);
  await expect(ingestFeature(root, { id: 'pip-dance', kind: 'motion', render })).rejects.toThrow(FeatureError);
  expect((await loadManifest(root)).features).toEqual([]);
}, INGEST_TIMEOUT_MS);

test('prepare hands out a feature example with its inputs, its workflows and its HD pass', async () => {
  const report = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
  mkdirSync(join(report, '..'), { recursive: true });
  writeFileSync(report, JSON.stringify({ ok: true, checkedAt: '2026-10-26T20:00:00.000Z', models: [], violations: [] }));
  const photo = photoOf(runs);
  const render = motionRun(join(runs, 'render'), photo);
  const hd = await hdRun(join(runs, 'hd'), join(render, 'clips', 'x__ext-motion__wan-animate2-motion__r1-1.mp4'), 'vit-motion-pip.mp4');
  await ingestFeature(root, { id: 'pip-dance', kind: 'motion', render, photo, face: 'pip', hd });
  const out = join(root, 'apps', 'web', 'public', 'showcase');
  const data = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  const [example] = data.features ?? [];
  expect(example).toMatchObject({
    id: 'pip-dance',
    feature: 'motion',
    url: 'features/pip-dance.mp4',
    poster: 'features/pip-dance.jpg',
    audio: false,
    face: 'pip',
    inputs: [
      { role: 'photo', url: 'features/inputs/pip-dance--photo.jpg' },
      { role: 'clip', url: 'features/inputs/pip-dance--clip.mp4' },
    ],
    steps: [{ model: { id: 'wan-animate2-motion' }, workflowUrl: 'workflows/feature-pip-dance--1-wan-animate2-motion.json' }],
    hd: { id: 'seedvr2-upscale', fps: 32, workflowUrl: 'workflows/feature-pip-dance--hd.json' },
  });
  for (const url of [example!.url, example!.poster, ...example!.inputs.map((input) => input.url), example!.steps[0]!.workflowUrl, example!.hd!.workflowUrl]) {
    expect(existsSync(join(out, url)), url).toBe(true);
  }
  const workflow = JSON.parse(readFileSync(join(out, example!.hd!.workflowUrl), 'utf8')) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  expect(Object.values(workflow).some((node) => node.class_type === 'FrameInterpolate')).toBe(true);
  expect(await probeAudio(join(out, example!.url))).toBeNull();
}, INGEST_TIMEOUT_MS);
