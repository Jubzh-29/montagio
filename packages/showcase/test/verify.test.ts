import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_METADATA, normalizeClip, PLACEHOLDER_METADATA } from '@montagio/sequence';
import { runCli } from '../src/cli';
import { verifyShowcase } from '../src/verify';
import { addRenderedClip, FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, repoRoot, sha256Of, showcasePath } from './helpers';

const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const rawA = join(raws, 'a.mp4');
const rawB = join(raws, 'b.mp4');
let root = '';

beforeAll(() => {
  rawRender(rawA, 'testsrc2');
  rawRender(rawB, 'testsrc');
}, FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
});
afterEach(() => removeRoot(root));
afterAll(() => removeRoot(raws));

test('a fresh manifest verifies with placeholder warnings, and fails in strict mode', async () => {
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toEqual([]);
  expect(report).toMatchObject({ rendered: 0, placeholders: 2 });
  expect(report.warnings).toContainEqual(expect.stringMatching(/^samples\/landscape-a\.jpg: placeholder photo/));
  expect(report.warnings).toContainEqual(expect.stringMatching(/^crash-push × landscape-a: no rendered clip/));

  const strict = await verifyShowcase(root, { strict: true });
  expect(strict.errors).toEqual(expect.arrayContaining(report.warnings));
  expect(strict.warnings).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('rendered clips of one sample verify and join without re-encoding', async () => {
  await addRenderedClip(root, rawA, 'crash-push');
  await addRenderedClip(root, rawB, 'pan-left', { seed: 9 });
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toEqual([]);
  expect(report).toMatchObject({ rendered: 2, placeholders: 0 });
}, FFMPEG_TIMEOUT_MS);

test('a tampered clip fails on its sha256', async () => {
  const file = await addRenderedClip(root, rawA, 'crash-push');
  appendFileSync(file, Buffer.from([0]));
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^clips\/crash-push--landscape-a\.mp4: sha256 is [0-9a-f]{64}, the manifest says/));
}, FFMPEG_TIMEOUT_MS);

test('the tracked manifest accepts only the Montagio metadata hashes in strict mode', async () => {
  const source = showcasePath(repoRoot, 'clips', 'crash-push--landscape-a.mp4');
  const reference = join(raws, 'montagio-metadata.mp4');
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', source, '-map', '0', '-c', 'copy', '-map_metadata', '-1',
    ...Object.entries(AI_METADATA).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]), reference,
  ]);
  const { loadManifest } = await import('../src/manifest');
  const manifest = await loadManifest(repoRoot);
  const entry = manifest.clips.find((clip) => clip.preset === 'crash-push' && clip.sample === 'landscape-a')!;
  expect(entry.sha256).toBe(sha256Of(reference));
  expect((await verifyShowcase(repoRoot, { strict: true })).errors).toEqual([]);
}, FFMPEG_TIMEOUT_MS);

test('a changed preset camera fails on workflow_sha256 in strict mode, but a changed description does not', async () => {
  await addRenderedClip(root, rawA, 'crash-push');
  const presetPath = join(root, 'presets', 'crash-push.yaml');
  const original = readFileSync(presetPath, 'utf8');

  writeFileSync(presetPath, original.replace(/^description: .*$/m, 'description: Reworded after the GPU session.'));
  expect((await verifyShowcase(root, { strict: true })).errors.filter((line) => /workflow/.test(line))).toEqual([]);

  writeFileSync(presetPath, original.replace('speed: 1.5', 'speed: 2'));
  const strict = await verifyShowcase(root, { strict: true });
  expect(strict.errors).toContainEqual(expect.stringMatching(/^crash-push × landscape-a: the workflow changed since this clip was rendered/));
  const relaxed = await verifyShowcase(root, { strict: false });
  expect(relaxed.errors).toEqual([]);
  expect(relaxed.warnings).toContainEqual(expect.stringMatching(/the workflow changed/));
}, FFMPEG_TIMEOUT_MS);

test('an orphan file in clips/ is an error', async () => {
  writeFileSync(showcasePath(root, 'clips', 'pan-left--landscape-a.mp4'), 'not listed');
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual('clips/pan-left--landscape-a.mp4: no manifest entry');
}, FFMPEG_TIMEOUT_MS);

test('a rendered clip without the AI-generated tag is an error', async () => {
  await addRenderedClip(root, rawA, 'crash-push', { tags: PLACEHOLDER_METADATA });
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^clips\/crash-push--landscape-a\.mp4: .*AI-generated/));
}, FFMPEG_TIMEOUT_MS);

test('a clip of the wrong length is an error', async () => {
  const file = await addRenderedClip(root, rawA, 'crash-push');
  const listed = sha256Of(file);
  // Swap in a 2 s clip and give the manifest its sha256: only the probe can catch it.
  const short = join(raws, 'short.mp4');
  rawRender(short, 'testsrc', 33);
  await normalizeClip(short, file, { width: 832, height: 480, fps: 16, tags: AI_METADATA });
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(listed, sha256Of(file)));
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^clips\/crash-push--landscape-a\.mp4: lasts 2\.\d+ s, the preset makes 5\.06 s/));
}, FFMPEG_TIMEOUT_MS);

test('a sample whose shape is not the declared aspect, and an unknown model, are errors', async () => {
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace("aspect: '16:9'", "aspect: '9:16'").replace('model: wan22-i2v-a14b-fun-camera', 'model: nowhere'));
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^samples\/landscape-a\.jpg: the photo is 16:9, the manifest says 9:16/));
  expect(report.errors).toContainEqual(expect.stringMatching(/^model: "nowhere" is not in the registry/));
}, FFMPEG_TIMEOUT_MS);

test('verify prints the errors and exits 1', async () => {
  writeFileSync(showcasePath(root, 'clips', 'stray.mp4'), 'x');
  const out: string[] = [];
  const code = await runCli(['verify'], { root, out: (line) => out.push(line), err: (line) => out.push(line) });
  expect(code).toBe(1);
  expect(out).toContainEqual('error: clips/stray.mp4: no manifest entry');
  expect(out.at(-1)).toMatch(/^showcase: 0 rendered, 2 placeholders, 1 error/);
}, FFMPEG_TIMEOUT_MS);

test('rendered clips of a sample that do not share their H.264 headers are an error', async () => {
  await addRenderedClip(root, rawA, 'crash-push');
  const odd = await addRenderedClip(root, rawB, 'pan-left', { seed: 9 });
  // Re-encode the second one with another colour description, keep the manifest's sha256 true.
  const listed = sha256Of(odd);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', rawB, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt470bg', '-metadata', 'comment=AI-generated', '-f', 'mp4', `${odd}.tmp`,
  ]);
  renameSync(`${odd}.tmp`, odd);
  const manifestPath = showcasePath(root, 'manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(listed, sha256Of(odd)));
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^landscape-a: its rendered clips do not share their H\.264 headers \(clips\/pan-left--landscape-a\.mp4 differs\)/));
}, FFMPEG_TIMEOUT_MS);

test('a clip rendered from another photo than the sample is an error', async () => {
  await addRenderedClip(root, rawA, 'crash-push');
  // The photo is regenerated after the clip was rendered and ingested.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=1664x960', '-frames:v', '1', showcasePath(root, 'samples', 'landscape-a.jpg')]);
  const report = await verifyShowcase(root, { strict: false });
  expect(report.errors).toContainEqual(expect.stringMatching(/^crash-push × landscape-a: rendered from another photo than samples\/landscape-a\.jpg/));
}, FFMPEG_TIMEOUT_MS);
