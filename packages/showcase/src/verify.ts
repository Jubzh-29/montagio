import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { frameCount, LibraryError, loadLibrary, pickAspect, type ApiWorkflow, type Aspect, type Library } from '@montagio/presets';
import { AI_METADATA, concatCopy, decodeCheck, headerHash, probe, readTags } from '@montagio/sequence';
import { imageSize } from 'image-size';
import { effectFile, exampleWorkflowFile, hookFile, loadManifest, ManifestError, SHOWCASE_DIR, type HdPass, type Manifest } from './manifest';
import { planClips, renderedSize, strayClips, type PlannedClip } from './plan';
import { hdWorkflow, showcaseWorkflow, workflowSha256 } from './workflow';

export type VerifyReport = { errors: string[]; warnings: string[]; rendered: number; placeholders: number; examples: number };

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
    return { errors, warnings, rendered: 0, placeholders: 0, examples: 0 };
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

  /** A file's 1080p pass: an upscaler of the registry, and the workflow it was compiled into. */
  const checkHd = (label: string, hd: HdPass, aspect: Aspect) => {
    let workflow: ApiWorkflow;
    try {
      workflow = hdWorkflow(library, hd, aspect);
    } catch (error) {
      errors.push(`${label}: its HD pass: ${(error as Error).message}`);
      return;
    }
    if (workflowSha256(workflow) !== hd.workflow_sha256) gate(`${label}: the workflow of its HD pass changed since it was rendered (template or compiler)`);
  };

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
      const workflow = showcaseWorkflow(library, manifest, item.preset, item.sample, item.rendered.seed, item.rendered);
      if (workflowSha256(workflow) !== item.rendered.workflow_sha256) {
        gate(`${item.preset.id} × ${item.sample.id}: the workflow changed since this clip was rendered (preset camera, prompt, length, template or compiler)`);
      }
    }
    if (item.rendered.hd) checkHd(`${item.preset.id} × ${item.sample.id}`, item.rendered.hd, item.sample.aspect);
  }

  // The effect and hook examples: each file as ingest wrote it, from the current photo, with its workflow.
  const examples = [
    ...manifest.effects.map((entry) => ({ kind: 'effect' as const, id: entry.effect, entry, file: effectFile(entry.effect, entry.sample), known: library.effects.has(entry.effect) })),
    ...manifest.hooks.map((entry) => ({ kind: 'hook' as const, id: entry.hook, entry, file: hookFile(entry.hook, entry.sample), known: library.hooks.has(entry.hook) })),
  ];
  for (const example of examples) {
    const label = `${example.kind} ${example.id} × ${example.entry.sample}`;
    if (!example.known) {
      errors.push(`${label}: "${example.id}" is not ${example.kind === 'effect' ? 'an effect' : 'a hook'} of the library`);
      continue;
    }
    listed.add(example.file);
    const sample = manifest.samples.find((candidate) => candidate.id === example.entry.sample)!;
    errors.push(...(await checkExampleClip(dir, example.file, example.entry.sha256, renderedSize(sample.aspect, '480p', !!example.entry.hd))));
    const photo = photoSha.get(sample.id);
    if (photo && photo !== example.entry.image_sha256) {
      errors.push(`${label}: rendered from another photo than ${sample.file} (image_sha256 differs); render it again from this photo`);
    }
    if (example.entry.hd) checkHd(label, example.entry.hd, sample.aspect);
    const workflow = exampleWorkflowFile(example.kind, example.id, sample.id);
    listed.add(workflow);
    try {
      const text = await readFile(join(dir, workflow), 'utf8');
      if (workflowSha256(JSON.parse(text) as ApiWorkflow) !== example.entry.workflow_sha256) {
        errors.push(`${workflow}: the workflow changed since it was ingested (workflow_sha256 differs)`);
      }
    } catch {
      errors.push(`${workflow}: missing or not JSON`);
    }
  }

  for (const folder of ['clips', 'effects', 'hooks']) {
    let files: string[] = [];
    try {
      files = (await readdir(join(dir, folder))).filter((name) => !name.startsWith('.'));
    } catch {
      // no such folder yet: nothing rendered there
    }
    for (const name of files) if (!listed.has(`${folder}/${name}`)) errors.push(`${folder}/${name}: no manifest entry`);
  }

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
  return { errors, warnings, rendered, placeholders: planned.length - rendered, examples: examples.length };
}

/** Effects and transitions render at 480p and 16 fps. */
const EXAMPLE_FPS = 16;

/** The file of an effect or hook example against its entry: sha256, stream, size, mention. */
async function checkExampleClip(dir: string, file: string, sha256: string, expected: { width: number; height: number }): Promise<string[]> {
  const path = join(dir, file);
  const problems: string[] = [];
  let actual: string;
  try {
    actual = await sha256File(path);
  } catch {
    return [`${file}: missing`];
  }
  if (actual !== sha256) problems.push(`${file}: sha256 is ${actual}, the manifest says ${sha256}`);
  try {
    const info = await probe(path);
    if (info.codec !== 'h264' || info.pixFmt !== 'yuv420p') problems.push(`${file}: ${info.codec}/${info.pixFmt}, expected h264/yuv420p`);
    if (info.width !== expected.width || info.height !== expected.height) problems.push(`${file}: ${info.width}x${info.height}, expected ${expected.width}x${expected.height}`);
    if (Math.abs(info.fps - EXAMPLE_FPS) > FPS_TOLERANCE) problems.push(`${file}: ${info.fps} fps, expected ${EXAMPLE_FPS}`);
    const tags = await readTags(path);
    if (tags.comment !== AI_METADATA.comment) problems.push(`${file}: the MP4 comment is not "${AI_METADATA.comment}"`);
  } catch (error) {
    problems.push(`${file}: unreadable video (${(error as Error).message})`);
  }
  return problems;
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
  const hd = !!item.rendered!.hd;
  const expected = renderedSize(item.sample.aspect, defaults.resolution, hd);
  const seconds = frameCount(defaults.duration_s, defaults.fps) / defaults.fps;
  try {
    const info = await probe(path);
    if (info.codec !== 'h264' || info.pixFmt !== 'yuv420p') problems.push(`${item.file}: ${info.codec}/${info.pixFmt}, expected h264/yuv420p`);
    if (info.width !== expected.width || info.height !== expected.height) {
      problems.push(`${item.file}: ${info.width}x${info.height}, the ${hd ? 'HD pass' : 'preset'} makes ${expected.width}x${expected.height}`);
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
