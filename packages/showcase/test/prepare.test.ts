import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_METADATA, PLACEHOLDER_METADATA, probe, readTags } from '@montagio/sequence';
import type { ShowcaseData } from '../src/data';
import { prepareShowcase } from '../src/prepare';
import { addRenderedClip, FFMPEG_TIMEOUT_MS, makeRoot, rawRender, removeRoot, sha256Of } from './helpers';

/** prepare runs real FFmpeg on 2 presets × 1 sample, twice in some tests. */
const PREPARE_TIMEOUT_MS = 180_000;
const raws = mkdtempSync(join(tmpdir(), 'montagio-raw-'));
const rawA = join(raws, 'a.mp4');
let root = '';
let out = '';

function writeReport(dir: string): void {
  const path = join(dir, 'apps', 'web', 'public', 'open-stack-report.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ ok: true, checkedAt: '2026-10-18T20:00:00.000Z', models: [], violations: [] }));
}

beforeAll(() => rawRender(rawA), FFMPEG_TIMEOUT_MS);
beforeEach(() => {
  root = makeRoot();
  writeReport(root);
  out = join(root, 'apps', 'web', 'public', 'showcase');
});
afterEach(() => removeRoot(root));
afterAll(() => rmSync(raws, { recursive: true, force: true }));

test('writes a placeholder clip, its 9:16 variant and the workflow for every pair', async () => {
  await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  for (const preset of ['crash-push', 'pan-left']) {
    const clip = join(out, 'clips', `${preset}--landscape-a.mp4`);
    const vertical = join(out, 'clips', `${preset}--landscape-a.9x16.mp4`);
    expect(await probe(clip)).toMatchObject({ width: 832, height: 480, fps: 16, codec: 'h264' });
    expect((await probe(clip)).duration_s).toBeCloseTo(81 / 16, 1);
    expect(await probe(vertical)).toMatchObject({ width: 720, height: 1280, fps: 16 });
    for (const file of [clip, vertical]) expect(await readTags(file)).toMatchObject(PLACEHOLDER_METADATA);
    const workflow = JSON.parse(readFileSync(join(out, 'workflows', `${preset}--landscape-a.json`), 'utf8')) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const nodes = Object.values(workflow);
    expect(nodes.find((node) => node.class_type === 'LoadImage')?.inputs.image).toBe('landscape-a.jpg');
    expect(nodes.some((node) => node.inputs.noise_seed === 42 || node.inputs.seed === 42)).toBe(true);
  }
  expect(sha256Of(join(out, 'samples', 'landscape-a.jpg'))).toBe(sha256Of(join(root, 'demo-assets', 'showcase', 'samples', 'landscape-a.jpg')));
}, PREPARE_TIMEOUT_MS);

test('copies a rendered clip as it is and marks it not placeholder', async () => {
  const rendered = await addRenderedClip(root, rawA, 'crash-push', { seed: 7 });
  const data = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  expect(sha256Of(join(out, 'clips', 'crash-push--landscape-a.mp4'))).toBe(sha256Of(rendered));
  expect(await readTags(join(out, 'clips', 'crash-push--landscape-a.9x16.mp4'))).toMatchObject(AI_METADATA);
  expect(data.clips.find((clip) => clip.preset === 'crash-push')).toMatchObject({ placeholder: false });
  expect(data.clips.find((clip) => clip.preset === 'pan-left')).toMatchObject({ placeholder: true });
  const workflow = readFileSync(join(out, 'workflows', 'crash-push--landscape-a.json'), 'utf8');
  expect(workflow).toMatch(/"(noise_)?seed": 7/);
}, PREPARE_TIMEOUT_MS);

test('writes the recipe of a rendered clip, and none for a placeholder', async () => {
  await addRenderedClip(root, rawA, 'crash-push', { seed: 7 });
  const data = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  const clip = data.clips.find((entry) => entry.preset === 'crash-push')!;
  expect(clip.recipeUrl).toBe('recipes/crash-push--landscape-a.json');
  const recipe = JSON.parse(readFileSync(join(out, clip.recipeUrl!), 'utf8')) as { schema: string; seed: number; steps: { name: string }[]; stack: { comfyui: { tag: string } } };
  expect(recipe).toMatchObject({ schema: 'montagio/recipe@1', seed: 7, steps: [{ name: 'camera' }], stack: { comfyui: { tag: 'v0.41.0' } } });
  expect(data.clips.find((entry) => entry.preset === 'pan-left')!.recipeUrl).toBeUndefined();
  expect(existsSync(join(out, 'recipes', 'pan-left--landscape-a.json'))).toBe(false);
}, PREPARE_TIMEOUT_MS);

test('data.json lists presets with their YAML, the library, the samples and the clips', async () => {
  const returned = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: 'https://example.org/montagio' });
  const data = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8')) as ShowcaseData;
  expect(data).toEqual(returned);
  expect(data.schema).toBe('montagio/showcase-data@0.1');
  expect(data.repoUrl).toBe('https://example.org/montagio');
  expect(data.model).toEqual({ id: 'wan22-i2v-a14b-fun-camera', name: 'Wan 2.2 Fun Camera', license: 'Apache-2.0' });
  const crash = data.presets.find((preset) => preset.id === 'crash-push')!;
  expect(crash).toMatchObject({ name: 'Crash Push', poses: ['zoom_in'], speed: 1.5, defaultModel: 'wan22-i2v-a14b-fun-camera' });
  expect(crash.yaml).toBe(readFileSync(join(root, 'presets', 'crash-push.yaml'), 'utf8'));
  expect(data.models.map((model) => model.id).sort()).toEqual(['wan22-i2v-a14b-fun-camera', 'wan22-i2v-a14b-fun-camera-turbo', 'wan22-ti2v-5b', 'z-image-turbo']);
  expect(new Map(data.library.models).get('wan22-i2v-a14b-fun-camera')?.workflow).toBe('workflows/wan22-fun-camera.api.json');
  expect(new Map(data.library.templates).has('workflows/wan22-fun-camera.api.json')).toBe(true);
  expect(data.library.lock.length).toBeGreaterThan(0);
  expect(data.library.lock.filter(([, entry]) => entry.extension)).toEqual([]);
  expect(data.samples).toEqual([
    {
      id: 'landscape-a',
      title: { en: 'Placeholder landscape A', fr: 'Paysage provisoire A' },
      aspect: '16:9',
      url: 'samples/landscape-a.jpg',
      placeholder: true,
      credit: 'Placeholder made with FFmpeg (lavfi)',
    },
  ]);
  expect(data.clips).toContainEqual({
    preset: 'pan-left',
    sample: 'landscape-a',
    url: 'clips/pan-left--landscape-a.mp4',
    verticalUrl: 'clips/pan-left--landscape-a.9x16.mp4',
    workflowUrl: 'workflows/pan-left--landscape-a.json',
    placeholder: true,
  });
  expect(data.openStack).toMatchObject({ ok: true });
}, PREPARE_TIMEOUT_MS);

test('a second run reuses the cached files', async () => {
  await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  const files = ['clips/crash-push--landscape-a.mp4', 'clips/crash-push--landscape-a.9x16.mp4'].map((file) => join(out, file));
  const before = files.map((file) => statSync(file).mtimeMs);
  await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  expect(files.map((file) => statSync(file).mtimeMs)).toEqual(before);
}, PREPARE_TIMEOUT_MS);

test('removes a stale clip from the output', async () => {
  mkdirSync(join(out, 'clips'), { recursive: true });
  writeFileSync(join(out, 'clips', 'old-preset--landscape-a.mp4'), 'stale');
  await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  expect(existsSync(join(out, 'clips', 'old-preset--landscape-a.mp4'))).toBe(false);
  expect(existsSync(join(out, 'clips', 'crash-push--landscape-a.mp4'))).toBe(true);
}, PREPARE_TIMEOUT_MS);

test('fails without the open-stack report', async () => {
  rmSync(join(root, 'apps', 'web', 'public', 'open-stack-report.json'));
  await expect(prepareShowcase(root, { outDir: out, strict: false, repoUrl: null })).rejects.toThrow(/open-stack-report\.json.*check:open-stack/);
}, PREPARE_TIMEOUT_MS);

test('fails on the errors verify finds, and on placeholders in strict mode', async () => {
  writeFileSync(join(root, 'demo-assets', 'showcase', 'clips', 'stray.mp4'), 'x');
  await expect(prepareShowcase(root, { outDir: out, strict: false, repoUrl: null })).rejects.toThrow(/clips\/stray\.mp4: no manifest entry/);
  rmSync(join(root, 'demo-assets', 'showcase', 'clips', 'stray.mp4'));
  await expect(prepareShowcase(root, { outDir: out, strict: true, repoUrl: null })).rejects.toThrow(/placeholder photo/);
}, PREPARE_TIMEOUT_MS);

test('writes a light gallery preview per preset from the first sample clip', async () => {
  const data = await prepareShowcase(root, { outDir: out, strict: false, repoUrl: null });
  expect(data.presets.find((preset) => preset.id === 'crash-push')?.preview).toBe('previews/crash-push.mp4');
  const preview = join(out, 'previews', 'crash-push.mp4');
  expect(await probe(preview)).toMatchObject({ width: 320, height: 184, codec: 'h264' });
  expect(statSync(preview).size).toBeLessThan(statSync(join(out, 'clips', 'crash-push--landscape-a.mp4')).size / 3);
  expect(await readTags(preview)).toMatchObject(PLACEHOLDER_METADATA);
}, PREPARE_TIMEOUT_MS);

test('refuses a rendered clip whose H.264 headers differ from the other clips of its sample', async () => {
  // Decodes fine and joins without error, but tagged BT.601: joined with -c copy behind
  // the placeholders, it would play with their colour description.
  const odd = join(raws, 'odd.mp4');
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', rawA, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt470bg', '-color_range', 'tv', '-metadata', 'comment=AI-generated', odd,
  ]);
  const file = await addRenderedClip(root, rawA, 'crash-push');
  copyFileSync(odd, file);
  const manifestPath = join(root, 'demo-assets', 'showcase', 'manifest.yaml');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(/sha256: [0-9a-f]{64},/, `sha256: ${sha256Of(file)},`));
  await expect(prepareShowcase(root, { outDir: out, strict: false, repoUrl: null })).rejects.toThrow(/do not share their H\.264 headers/);
}, PREPARE_TIMEOUT_MS);
