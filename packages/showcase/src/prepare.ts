import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { OpenStackReport } from '@montagio/check-open-stack';
import { dimensionsFor, frameCount, loadLibrary, type Library } from '@montagio/presets';
import {
  AI_METADATA,
  concatCopy,
  decodeCheck,
  exportVertical,
  headerHash,
  PLACEHOLDER_METADATA,
  placeholderClip,
  posterFrame,
  previewClip,
  SHOWCASE_COLOUR,
  SHOWCASE_X264,
} from '@montagio/sequence';
import type { ShowcaseData } from './data';
import { effectFile, exampleWorkflowFile, hookFile, loadManifest, SHOWCASE_DIR } from './manifest';
import { motionKeyframes, toZoompan } from './motion';
import { planClips, type PlannedClip } from './plan';
import { sha256File, verifyShowcase } from './verify';
import { DEFAULT_PLACEHOLDER_SEED, showcaseWorkflow } from './workflow';

/** Width of the gallery tile loops. */
const PREVIEW_WIDTH = 320;
const previewFile = (preset: string) => `previews/${preset}.mp4`;
/** The first frame of a clip, beside it: what a tile shows while the clip loads. */
const posterOf = (file: string) => file.replace(/\.mp4$/, '.jpg');

/** Bumped when the way prepare encodes changes: every cached file is then made again. */
const CACHE_VERSION = 'v2';
const CACHE_FILE = '.prepare-cache.json';

export class PrepareError extends Error {
  override name = 'PrepareError';
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

/**
 * What the page needs to check a remixed camera preset (validatePreset): the preset models,
 * their templates, and the lock without the extension weights, which no camera preset loads.
 */
export function remixLibrary(library: Library): ShowcaseData['library'] {
  return {
    models: [...library.models],
    templates: [...library.templates],
    lock: [...library.lock].filter(([, entry]) => !entry.extension),
  };
}

const hash = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify([CACHE_VERSION, ...parts])).digest('hex');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `dir`, relative to it with forward slashes. */
async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/**
 * Write the static showcase into `outDir` (apps/web/public/showcase by default):
 * every preset × sample clip (the rendered one, or a placeholder FFmpeg makes
 * from the photo), its 9:16 cut, the workflow that renders it, the photos and
 * data.json. A file whose inputs did not change since the last run is kept.
 */
export async function prepareShowcase(
  root: string,
  opts: { outDir?: string; strict: boolean; repoUrl: string | null },
): Promise<ShowcaseData> {
  const outDir = opts.outDir ?? join(root, 'apps', 'web', 'public', 'showcase');
  const showcaseDir = join(root, SHOWCASE_DIR);

  const report = await verifyShowcase(root, { strict: opts.strict });
  if (report.errors.length > 0) throw new PrepareError(report.errors);

  const reportPath = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
  let openStack: OpenStackReport;
  try {
    openStack = JSON.parse(await readFile(reportPath, 'utf8')) as OpenStackReport;
  } catch {
    throw new PrepareError([`apps/web/public/open-stack-report.json is missing or unreadable: run "npm run check:open-stack" first`]);
  }

  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const planned = planClips(manifest, library);
  let cache: Record<string, string> = {};
  try {
    cache = JSON.parse(await readFile(join(outDir, CACHE_FILE), 'utf8')) as Record<string, string>;
  } catch {
    // first run, or a cache from an older layout
  }
  const nextCache: Record<string, string> = {};
  const produced = new Set<string>([CACHE_FILE, 'data.json']);

  /** Make `file` with `make` unless the cache says it was made from the same inputs. */
  const ensure = async (file: string, fingerprint: string, make: (path: string) => Promise<void>) => {
    const path = join(outDir, file);
    produced.add(file);
    nextCache[file] = fingerprint;
    if (cache[file] === fingerprint && (await exists(path))) return;
    await mkdir(dirname(path), { recursive: true });
    await make(path);
  };

  const sampleSha = new Map<string, string>();
  for (const sample of manifest.samples) {
    const source = join(showcaseDir, sample.file);
    const sha = await sha256File(source);
    sampleSha.set(sample.id, sha);
    await ensure(sample.file, hash('sample', sha), (path) => copyFile(source, path));
  }

  for (const item of planned) {
    const clipPrint = await ensureClip(item, showcaseDir, sampleSha.get(item.sample.id)!, ensure);
    const tags = item.rendered ? AI_METADATA : PLACEHOLDER_METADATA;
    await ensure(item.vertical, hash('vertical', clipPrint, SHOWCASE_X264, SHOWCASE_COLOUR, tags), (path) =>
      exportVertical(join(outDir, item.file), path, { encoder: SHOWCASE_X264, colour: SHOWCASE_COLOUR, tags }),
    );
    // The gallery tile of a preset loops its clip on the first sample.
    if (item.sample.id === manifest.samples[0]!.id) {
      await ensure(previewFile(item.preset.id), hash('preview', clipPrint, PREVIEW_WIDTH, tags), (path) =>
        previewClip(join(outDir, item.file), path, { width: PREVIEW_WIDTH, tags }),
      );
      await ensure(posterOf(previewFile(item.preset.id)), hash('poster', clipPrint, PREVIEW_WIDTH, tags), (path) =>
        posterFrame(join(outDir, item.file), path, { width: PREVIEW_WIDTH, comment: tags.comment }),
      );
    }
    const workflow = showcaseWorkflow(library, manifest, item.preset, item.sample, item.rendered?.seed ?? DEFAULT_PLACEHOLDER_SEED);
    const workflowPath = join(outDir, item.workflow);
    produced.add(item.workflow);
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
  }

  // The effect and hook examples, copied as ingest wrote them, with their workflows.
  const exampleUrls = new Map<string, { sample: string; url: string; workflowUrl: string; poster: string }[]>();
  for (const [kind, entries] of [
    ['effect', manifest.effects.map((entry) => ({ id: entry.effect, entry }))],
    ['hook', manifest.hooks.map((entry) => ({ id: entry.hook, entry }))],
  ] as const) {
    for (const { id, entry } of entries) {
      const file = kind === 'effect' ? effectFile(id, entry.sample) : hookFile(id, entry.sample);
      const workflowUrl = exampleWorkflowFile(kind, id, entry.sample);
      await ensure(file, hash('example', entry.sha256), (path) => copyFile(join(showcaseDir, file), path));
      await ensure(posterOf(file), hash('example-poster', entry.sha256, PREVIEW_WIDTH), (path) =>
        posterFrame(join(outDir, file), path, { width: PREVIEW_WIDTH, comment: AI_METADATA.comment }),
      );
      await ensure(workflowUrl, hash('example-workflow', entry.workflow_sha256), (path) => copyFile(join(showcaseDir, workflowUrl), path));
      const key = `${kind}:${id}`;
      exampleUrls.set(key, [...(exampleUrls.get(key) ?? []), { sample: entry.sample, url: file, workflowUrl, poster: posterOf(file) }]);
    }
  }
  const exampleItem = (kind: 'effect' | 'hook', preset: { id: string; name: string; description: string; models: { preferred: string } }) => {
    const model = library.extensionModels.get(preset.models.preferred);
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      modelId: preset.models.preferred,
      modelName: model?.name ?? preset.models.preferred,
      license: model?.license ?? '',
      examples: exampleUrls.get(`${kind}:${preset.id}`) ?? [],
    };
  };

  // The browser joins a sample's clips (and their 9:16 cuts) with -c copy: prove it works here first.
  for (const sample of manifest.samples) {
    const items = planned.filter((item) => item.sample.id === sample.id);
    for (const kind of ['file', 'vertical'] as const) {
      const files = items.map((item) => item[kind]);
      const fingerprint = hash('join', files.map((file) => nextCache[file]));
      const key = `join:${sample.id}:${kind}`;
      nextCache[key] = fingerprint;
      if (cache[key] === fingerprint || files.length < 2) continue;
      await checkJoin(files.map((file) => join(outDir, file)), `${sample.id} (${kind === 'file' ? 'clips' : '9:16 cuts'})`);
    }
  }

  const data: ShowcaseData = {
    schema: 'montagio/showcase-data@0.1',
    builtAt: new Date().toISOString(),
    repoUrl: opts.repoUrl,
    model: modelSummary(library, manifest.model),
    presets: await Promise.all(
      [...library.presets.values()].map(async (preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        poses: [...preset.camera.poses],
        speed: preset.camera.speed,
        defaultModel: preset.models.preferred,
        preview: previewFile(preset.id),
        poster: posterOf(previewFile(preset.id)),
        yaml: await readFile(join(root, ...(library.presetFiles.get(preset.id) ?? `presets/${preset.id}.yaml`).split('/')), 'utf8'),
      })),
    ),
    models: [...library.models.values()].map((model) => ({
      id: model.id,
      name: model.name,
      kind: model.kind,
      tier: model.tier,
      license: model.license,
      estimate_s: model.estimate_s,
    })),
    library: remixLibrary(library),
    samples: manifest.samples.map((sample) => ({
      id: sample.id,
      title: sample.title,
      aspect: sample.aspect,
      url: sample.file,
      placeholder: sample.status === 'placeholder',
      credit: sample.credit,
      ...(sample.prompt ? { prompt: sample.prompt } : {}),
    })),
    clips: planned.map((item) => ({
      preset: item.preset.id,
      sample: item.sample.id,
      url: item.file,
      verticalUrl: item.vertical,
      workflowUrl: item.workflow,
      placeholder: item.rendered === null,
    })),
    effects: [...library.effects.values()].map((preset) => exampleItem('effect', preset)).filter((item) => item.examples.length > 0),
    hooks: [...library.hooks.values()]
      .map((preset) => ({ ...exampleItem('hook', preset), references: preset.end_frame.references }))
      .filter((item) => item.examples.length > 0),
    openStack,
  };
  await writeFile(join(outDir, 'data.json'), `${JSON.stringify(data)}\n`);

  for (const file of await listFiles(outDir)) if (!produced.has(file)) await rm(join(outDir, file), { force: true });
  await writeFile(join(outDir, CACHE_FILE), `${JSON.stringify(nextCache, null, 2)}\n`);
  return data;
}

/** The clip of a pair: the rendered file copied as it is, or a placeholder made from the photo. Returns its fingerprint. */
async function ensureClip(
  item: PlannedClip,
  showcaseDir: string,
  photoSha: string,
  ensure: (file: string, fingerprint: string, make: (path: string) => Promise<void>) => Promise<void>,
): Promise<string> {
  if (item.rendered) {
    const fingerprint = hash('rendered', item.rendered.sha256);
    await ensure(item.file, fingerprint, (path) => copyFile(join(showcaseDir, item.file), path));
    return fingerprint;
  }
  const { defaults, camera } = item.preset;
  const size = dimensionsFor(item.sample.aspect, defaults.resolution);
  const frames = frameCount(defaults.duration_s, defaults.fps);
  const motion = toZoompan(motionKeyframes(camera), frames);
  const fingerprint = hash('placeholder', photoSha, size, defaults.fps, frames, motion, SHOWCASE_X264, PLACEHOLDER_METADATA);
  await ensure(item.file, fingerprint, (path) =>
    placeholderClip(join(showcaseDir, item.sample.file), path, { ...size, fps: defaults.fps, frames, motion, tags: PLACEHOLDER_METADATA }),
  );
  return fingerprint;
}

async function checkJoin(files: string[], label: string): Promise<void> {
  // A -c copy join plays every clip with the first one's headers (colour description included).
  const headers = await Promise.all(files.map((file) => headerHash(file)));
  const odd = files.find((_, index) => headers[index] !== headers[0]);
  if (odd) throw new PrepareError([`${label}: the clips do not share their H.264 headers (${odd} differs from ${files[0]}); re-encode it with "showcase ingest"`]);
  const scratch = await mkdtemp(join(tmpdir(), 'montagio-prepare-'));
  try {
    const film = join(scratch, 'film.mp4');
    await concatCopy(files, film, AI_METADATA);
    await decodeCheck(film);
  } catch (error) {
    throw new PrepareError([`${label}: the clips cannot be joined without re-encoding (${(error as Error).message})`]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function modelSummary(library: Library, id: string): ShowcaseData['model'] {
  const model = library.models.get(id)!;
  return { id: model.id, name: model.name, license: model.license };
}
