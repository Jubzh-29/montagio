import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { OpenStackReport } from '@montagio/check-open-stack';
import { dimensionsFor, frameCount, loadLibrary, type Library } from '@montagio/presets';
import { readStack } from '@montagio/recipe';
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
import type { ShowcaseData, ShowcaseExampleItem, ShowcaseFeatureExample, ShowcaseHdModel, ShowcaseModel } from './data';
import {
  effectFile,
  exampleWorkflowFile,
  FEATURE_FPS,
  featureFile,
  featureHdWorkflowFile,
  featureWorkflowFile,
  hookFile,
  loadManifest,
  recipeFile,
  SHOWCASE_DIR,
  SMOOTH_FPS,
  SPEAKING_FEATURES,
  type HdPass,
} from './manifest';
import { motionKeyframes, toZoompan } from './motion';
import { planClips, type PlannedClip } from './plan';
import { showcaseRecipe } from './recipe';
import { sha256File, verifyShowcase } from './verify';
import { DEFAULT_PLACEHOLDER_SEED, hdWorkflow, showcaseWorkflow } from './workflow';

/** Width of the gallery tile loops. */
const PREVIEW_WIDTH = 320;
/** Width of a feature example's poster: its card shows it while the clip loads. */
const FEATURE_POSTER_WIDTH = 640;
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

  const [library, manifest, stack] = await Promise.all([loadLibrary(root), loadManifest(root), readStack(root)]);
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
    // The workflow that rendered the clip, with its own texts (the HD pass is in the manifest).
    const workflow = showcaseWorkflow(library, manifest, item.preset, item.sample, item.rendered?.seed ?? DEFAULT_PLACEHOLDER_SEED, item.rendered ?? {});
    const workflowPath = join(outDir, item.workflow);
    produced.add(item.workflow);
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
    // A rendered clip's recipe: its photo, render and HD pass by sha256, and the request that renders it at home.
    if (item.rendered) {
      const yaml = await readFile(join(root, ...(library.presetFiles.get(item.preset.id) ?? `presets/${item.preset.id}.yaml`).split('/')), 'utf8');
      const recipe = showcaseRecipe(library, manifest, item.rendered, item.sample, yaml, stack);
      const file = recipeFile(item.preset.id, item.sample.id);
      produced.add(file);
      await mkdir(dirname(join(outDir, file)), { recursive: true });
      await writeFile(join(outDir, file), `${JSON.stringify(recipe, null, 2)}\n`);
    }
  }

  // The effect and hook examples, copied as ingest wrote them, with their workflows.
  const exampleUrls = new Map<string, ShowcaseExampleItem['examples']>();
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
      const hd = hdModelOf(library, entry.hd);
      exampleUrls.set(key, [...(exampleUrls.get(key) ?? []), { sample: entry.sample, url: file, workflowUrl, poster: posterOf(file), ...(hd ? { hd } : {}) }]);
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

  // The feature examples, copied as ingest wrote them: the clip and its poster, what it started from,
  // the workflow of each job, and its HD pass compiled again (verify has checked its hash).
  const features: ShowcaseFeatureExample[] = [];
  for (const entry of manifest.features) {
    const file = featureFile(entry.id);
    await ensure(file, hash('feature', entry.sha256), (path) => copyFile(join(showcaseDir, file), path));
    await ensure(posterOf(file), hash('feature-poster', entry.sha256, FEATURE_POSTER_WIDTH), (path) =>
      posterFrame(join(outDir, file), path, { width: FEATURE_POSTER_WIDTH, comment: AI_METADATA.comment }),
    );
    for (const input of entry.inputs) await ensure(input.file, hash('feature-input', input.sha256), (path) => copyFile(join(showcaseDir, input.file), path));
    const steps = [];
    for (const [index, step] of entry.steps.entries()) {
      const workflowUrl = featureWorkflowFile(entry.id, index, step.model);
      await ensure(workflowUrl, hash('feature-workflow', step.workflow_sha256), (path) => copyFile(join(showcaseDir, workflowUrl), path));
      steps.push({ model: modelOf(library, step.model), workflowUrl });
    }
    let hd: ShowcaseFeatureExample['hd'];
    if (entry.hd) {
      const workflowUrl = featureHdWorkflowFile(entry.id);
      const workflow = hdWorkflow(library, entry.hd, entry.aspect);
      produced.add(workflowUrl);
      await writeFile(join(outDir, workflowUrl), `${JSON.stringify(workflow, null, 2)}\n`);
      hd = { ...modelOf(library, entry.hd.model), fps: entry.hd.smooth ? SMOOTH_FPS : FEATURE_FPS, workflowUrl };
    }
    features.push({
      id: entry.id,
      feature: entry.feature,
      aspect: entry.aspect,
      url: file,
      poster: posterOf(file),
      audio: SPEAKING_FEATURES.has(entry.feature),
      ...(entry.text ? { text: entry.text } : {}),
      ...(entry.language ? { language: entry.language } : {}),
      ...(entry.face ? { face: entry.face } : {}),
      ...(entry.from ? { from: entry.from } : {}),
      ...(entry.style ? { style: entry.style } : {}),
      ...(entry.post ? { post: entry.post } : {}),
      inputs: entry.inputs.map((input) => ({ role: input.role, url: input.file })),
      steps,
      ...(hd ? { hd } : {}),
    });
  }

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
        // Every clip here was rendered with the manifest's model, whatever a preset starts on locally (the Turbo).
        defaultModel: manifest.model,
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
    clips: planned.map((item) => {
      const hd = hdModelOf(library, item.rendered?.hd);
      return {
        preset: item.preset.id,
        sample: item.sample.id,
        url: item.file,
        verticalUrl: item.vertical,
        workflowUrl: item.workflow,
        ...(item.rendered ? { recipeUrl: recipeFile(item.preset.id, item.sample.id) } : {}),
        placeholder: item.rendered === null,
        ...(hd ? { hd } : {}),
      };
    }),
    effects: [...library.effects.values()].map((preset) => exampleItem('effect', preset)).filter((item) => item.examples.length > 0),
    hooks: [...library.hooks.values()]
      .map((preset) => ({ ...exampleItem('hook', preset), references: preset.end_frame.references }))
      .filter((item) => item.examples.length > 0),
    features,
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

/** A model of the registry as a feature example's caption names it (verify has checked it is there). */
function modelOf(library: Library, id: string): ShowcaseModel {
  const model = library.extensionModels.get(id);
  return { id, name: model?.name ?? id, license: model?.license ?? '' };
}

/** The upscaler of a file's HD pass, as the caption names it (verify has checked it is in the registry). */
function hdModelOf(library: Library, hd: HdPass | undefined): ShowcaseHdModel | undefined {
  const model = hd && library.extensionModels.get(hd.model);
  return model ? { id: model.id, name: model.name, license: model.license } : undefined;
}
