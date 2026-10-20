import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '@montagio/presets';
import { AI_METADATA, normalizeClip, type VideoTags } from '@montagio/sequence';
import { loadManifest, SHOWCASE_DIR } from '../src/manifest';
import { showcaseWorkflow, workflowSha256 } from '../src/workflow';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** Real FFmpeg runs: generous budgets, as in packages/sequence, for a loaded machine. */
export const FFMPEG_TIMEOUT_MS = 60_000;

export const ONE_SAMPLE_MANIFEST = `schema: montagio/showcase@0.1
# The model every rendered clip was made with.
model: wan22-i2v-a14b-fun-camera
samples:
  - id: landscape-a
    file: samples/landscape-a.jpg
    aspect: '16:9'
    title: { en: Placeholder landscape A, fr: Paysage provisoire A }
    status: placeholder
    credit: Placeholder made with FFmpeg (lavfi)
clips: []
`;

export const sha256Of = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const showcasePath = (root: string, ...parts: string[]) => join(root, SHOWCASE_DIR, ...parts);

/**
 * A throwaway repository: the real registry and workflows, two presets
 * (Crash Push, Pan Left), and a showcase with one 16:9 sample photo.
 */
export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'montagio-showcase-'));
  cpSync(join(repoRoot, 'registry'), join(root, 'registry'), { recursive: true });
  cpSync(join(repoRoot, 'workflows'), join(root, 'workflows'), { recursive: true });
  mkdirSync(join(root, 'presets'));
  for (const id of ['crash-push', 'pan-left']) cpSync(join(repoRoot, 'presets', `${id}.yaml`), join(root, 'presets', `${id}.yaml`));
  mkdirSync(showcasePath(root, 'samples'), { recursive: true });
  mkdirSync(showcasePath(root, 'clips'), { recursive: true });
  writeFileSync(showcasePath(root, 'manifest.yaml'), ONE_SAMPLE_MANIFEST);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1664x960', '-frames:v', '1', showcasePath(root, 'samples', 'landscape-a.jpg')]);
  return root;
}

export const removeRoot = (root: string) => rmSync(root, { recursive: true, force: true, maxRetries: 5 });

/** What ComfyUI hands back for a 5 s preset: 81 frames of 832x480 at 16 fps. */
export function rawRender(path: string, source = 'testsrc2', frames = 81): void {
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `${source}=size=832x480:rate=16`, '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path,
  ]);
}

/**
 * Put a rendered clip of `preset` in the showcase as ingest would: normalized, tagged,
 * and listed with its sha256 and the sha256 of the workflow that renders it with `seed`.
 */
export async function addRenderedClip(
  root: string,
  raw: string,
  preset: string,
  opts: { seed?: number; tags?: VideoTags } = {},
): Promise<string> {
  const seed = opts.seed ?? 42;
  const file = showcasePath(root, 'clips', `${preset}--landscape-a.mp4`);
  await normalizeClip(raw, file, { width: 832, height: 480, fps: 16, tags: opts.tags ?? AI_METADATA });
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const workflow = showcaseWorkflow(library, manifest, library.presets.get(preset)!, manifest.samples[0]!, seed);
  const manifestPath = showcasePath(root, 'manifest.yaml');
  const text = readFileSync(manifestPath, 'utf8').replace('clips: []\n', 'clips:\n');
  writeFileSync(
    manifestPath,
    `${text}  - { preset: ${preset}, sample: landscape-a, seed: ${seed}, sha256: ${sha256Of(file)}, image_sha256: ${sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg'))}, workflow_sha256: ${workflowSha256(workflow)}, rendered_at: 2026-10-24 }\n`,
  );
  return file;
}

/**
 * Put an effect or hook example on landscape-a as `ingest --examples` would: the presets of
 * effects and hooks in the root, the clip normalized and tagged, its workflow, its manifest entry.
 */
export async function addExample(root: string, raw: string, kind: 'effect' | 'hook', id: string, seed = 42): Promise<string> {
  for (const folder of ['effects', 'transitions']) cpSync(join(repoRoot, 'presets', folder), join(root, 'presets', folder), { recursive: true });
  const folder = kind === 'effect' ? 'effects' : 'hooks';
  const file = showcasePath(root, folder, `${id}--landscape-a.mp4`);
  mkdirSync(join(file, '..'), { recursive: true });
  await normalizeClip(raw, file, { width: 832, height: 480, fps: 16, tags: AI_METADATA });
  const workflow = { '1': { class_type: 'Marker', inputs: { example: `${kind}:${id}` } } };
  mkdirSync(showcasePath(root, 'workflows'), { recursive: true });
  writeFileSync(showcasePath(root, 'workflows', `${kind}-${id}--landscape-a.json`), `${JSON.stringify(workflow, null, 2)}\n`);
  const manifestPath = showcasePath(root, 'manifest.yaml');
  const section = kind === 'effect' ? 'effects' : 'hooks';
  let text = readFileSync(manifestPath, 'utf8');
  const entry = `  - { ${kind}: ${id}, sample: landscape-a, seed: ${seed}, sha256: ${sha256Of(file)}, image_sha256: ${sha256Of(showcasePath(root, 'samples', 'landscape-a.jpg'))}, workflow_sha256: ${workflowSha256(workflow)}, rendered_at: 2026-10-24 }\n`;
  text = text.includes(`${section}:\n`) ? text.replace(`${section}:\n`, `${section}:\n${entry}`) : `${text}${section}:\n${entry}`;
  writeFileSync(manifestPath, text);
  return file;
}
