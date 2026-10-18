import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { dimensionsFor, frameCount, LibraryError, loadLibrary, pickAspect, type Library } from '@montagio/presets';
import { AI_METADATA, concatCopy, decodeCheck, headerHash, probe, readTags } from '@montagio/sequence';
import { imageSize } from 'image-size';
import { loadManifest, ManifestError, SHOWCASE_DIR, type Manifest } from './manifest';
import { planClips, strayClips, type PlannedClip } from './plan';
import { showcaseWorkflow, workflowSha256 } from './workflow';

export type VerifyReport = { errors: string[]; warnings: string[]; rendered: number; placeholders: number };

const FPS_TOLERANCE = 0.01;
const DURATION_TOLERANCE_S = 0.1;

export const sha256File = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

/**
 * Check the showcase as the free demo link will show it. Without `strict`,
 * placeholders and a workflow that changed since a render are warnings (the
 * showcase still builds); with `strict` (before the final deploy) they are errors.
 */
export async function verifyShowcase(root: string, opts: { strict: boolean }): Promise<VerifyReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const gate = (line: string) => (opts.strict ? errors : warnings).push(line);
  const dir = join(root, SHOWCASE_DIR);

  let library: Library;
  let manifest: Manifest;
  try {
    [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  } catch (error) {
    if (error instanceof ManifestError) errors.push(...error.problems.map((problem) => `manifest.yaml: ${problem}`));
    else if (error instanceof LibraryError) errors.push(...error.problems.map((problem) => `library: ${problem}`));
    else errors.push(`manifest.yaml: ${(error as Error).message}`);
    return { errors, warnings, rendered: 0, placeholders: 0 };
  }

  const modelKnown = library.models.has(manifest.model);
  if (!modelKnown) errors.push(`model: "${manifest.model}" is not in the registry`);

  const photoSha = new Map<string, string>();
  for (const sample of manifest.samples) {
    try {
      const bytes = await readFile(join(dir, sample.file));
      photoSha.set(sample.id, createHash('sha256').update(bytes).digest('hex'));
      const { width, height } = imageSize(bytes);
      if (!width || !height) throw new Error('no size');
      const aspect = pickAspect(width, height);
      if (aspect !== sample.aspect) errors.push(`${sample.file}: the photo is ${aspect}, the manifest says ${sample.aspect}`);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      errors.push(`${sample.file}: ${missing ? 'missing' : 'not a readable image'}`);
    }
    if (sample.status === 'placeholder') gate(`${sample.file}: placeholder photo (status: placeholder)`);
  }

  for (const clip of strayClips(manifest, library)) {
    errors.push(`${clip.preset} × ${clip.sample}: preset "${clip.preset}" is not in the library`);
  }

  const planned = planClips(manifest, library);
  const listed = new Set<string>();
  for (const item of planned) {
    if (!item.rendered) {
      gate(`${item.preset.id} × ${item.sample.id}: no rendered clip (a placeholder is generated)`);
      continue;
    }
    listed.add(item.file);
    errors.push(...(await checkRenderedClip(dir, item)));
    const photo = photoSha.get(item.sample.id);
    if (photo && photo !== item.rendered.image_sha256) {
      errors.push(`${item.preset.id} × ${item.sample.id}: rendered from another photo than ${item.sample.file} (image_sha256 differs); render it again from this photo`);
    }
    if (modelKnown) {
      const workflow = showcaseWorkflow(library, manifest, item.preset, item.sample, item.rendered.seed);
      if (workflowSha256(workflow) !== item.rendered.workflow_sha256) {
        gate(`${item.preset.id} × ${item.sample.id}: the workflow changed since this clip was rendered (preset camera, prompt, length, template or compiler)`);
      }
    }
  }

  let files: string[] = [];
  try {
    files = (await readdir(join(dir, 'clips'))).filter((name) => !name.startsWith('.'));
  } catch {
    // no clips/ folder yet: nothing rendered
  }
  for (const name of files) if (!listed.has(`clips/${name}`)) errors.push(`clips/${name}: no manifest entry`);

  // Every rendered clip of a sample must join the others with -c copy, as the browser joins them.
  for (const sample of manifest.samples) {
    const clips = planned.filter((item) => item.sample.id === sample.id && item.rendered).map((item) => join(dir, item.file));
    if (clips.length < 2 || errors.length > 0) continue;
    const headers = await Promise.all(clips.map((clip) => headerHash(clip)));
    const odd = clips.findIndex((_, index) => headers[index] !== headers[0]);
    if (odd !== -1) {
      errors.push(`${sample.id}: its rendered clips do not share their H.264 headers (${relative(dir, clips[odd]!).split(sep).join('/')} differs); re-ingest it`);
      continue;
    }
    const scratch = await mkdtemp(join(tmpdir(), 'montagio-verify-'));
    try {
      const film = join(scratch, 'film.mp4');
      await concatCopy(clips, film, AI_METADATA);
      await decodeCheck(film);
    } catch (error) {
      errors.push(`${sample.id}: its rendered clips cannot be joined without re-encoding (${(error as Error).message})`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  const rendered = planned.filter((item) => item.rendered).length;
  return { errors, warnings, rendered, placeholders: planned.length - rendered };
}

/** The file of a rendered clip against its entry and its preset: sha256, stream, length, mention. */
async function checkRenderedClip(dir: string, item: PlannedClip): Promise<string[]> {
  const path = join(dir, item.file);
  const problems: string[] = [];
  let actual: string;
  try {
    actual = await sha256File(path);
  } catch {
    return [`${item.file}: missing`];
  }
  if (actual !== item.rendered!.sha256) problems.push(`${item.file}: sha256 is ${actual}, the manifest says ${item.rendered!.sha256}`);

  const { defaults } = item.preset;
  const expected = dimensionsFor(item.sample.aspect, defaults.resolution);
  const seconds = frameCount(defaults.duration_s, defaults.fps) / defaults.fps;
  try {
    const info = await probe(path);
    if (info.codec !== 'h264' || info.pixFmt !== 'yuv420p') problems.push(`${item.file}: ${info.codec}/${info.pixFmt}, expected h264/yuv420p`);
    if (info.width !== expected.width || info.height !== expected.height) {
      problems.push(`${item.file}: ${info.width}x${info.height}, the preset makes ${expected.width}x${expected.height}`);
    }
    if (Math.abs(info.fps - defaults.fps) > FPS_TOLERANCE) problems.push(`${item.file}: ${info.fps} fps, the preset makes ${defaults.fps}`);
    if (Math.abs(info.duration_s - seconds) > DURATION_TOLERANCE_S) {
      problems.push(`${item.file}: lasts ${info.duration_s.toFixed(2)} s, the preset makes ${seconds.toFixed(2)} s`);
    }
    const tags = await readTags(path);
    if (tags.comment !== AI_METADATA.comment) problems.push(`${item.file}: the MP4 comment is not "${AI_METADATA.comment}"`);
  } catch (error) {
    problems.push(`${item.file}: unreadable video (${(error as Error).message})`);
  }
  return problems;
}
