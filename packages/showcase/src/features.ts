import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { alignText, buildAss, CAPTION_STYLES, isCaptionLanguage, isCaptionStyle, parseWordsDoc, wordsFromChunks } from '@montagio/captions';
import { dimensionsFor, loadLibrary, parseTrendSkeleton, pickAspect, UPSCALE_TARGETS, type ApiWorkflow, type Library } from '@montagio/presets';
import { AI_METADATA, normalizeClip, probe, probeAudio, renderVertical } from '@montagio/sequence';
import { isMap, isSeq, parseDocument, YAMLSeq } from 'yaml';
import {
  FEATURE_FPS,
  featureFile,
  featureInputFile,
  featureWorkflowFile,
  loadManifest,
  parseManifest,
  SHOWCASE_DIR,
  SMOOTH_FPS,
  SPEAKING_FEATURES,
  type FeatureEntry,
  type FeatureKind,
} from './manifest';
import { sha256File } from './verify';
import { hdWorkflow, workflowSha256 } from './workflow';

/** Where a feature example comes from: the smoke folders of its render and of its HD pass. */
export type FeatureSources = {
  /** The example's id in the manifest (kebab-case). */
  id: string;
  kind: FeatureKind;
  /** The smoke.ts folder of the render; for captions, the folder of the transcription. */
  render: string;
  /** The photo the render read (smoke --input): the avatar's portrait, the character that moves. */
  photo?: string;
  /** The starting face of the bank the photo is. */
  face?: string;
  /** The example it was made from: the avatar a translation says again, or whose captions it burns in. */
  from?: string;
  /** Its 1080p pass: the upscale's smoke folder, and the folder of the clips that run loaded (the volume's inputs/). */
  hd?: { dir: string; inputs: string };
  /** Captions: the corrected text and the style burned in, as the Studio's captions editor sends them. */
  captions?: { text: string; style: string };
};

export class FeatureError extends Error {
  override name = 'FeatureError';
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

/** The part of a smoke.jsonl extension record that the feature ingest reads. */
type JobRecord = {
  kind?: string;
  at: string;
  job: string;
  model: string;
  status: string;
  params?: Record<string, unknown>;
  inputs?: string[];
  outputs?: string[];
  image_sha256?: string | null;
};

/** The jobs each kind of example chains, in order: a name, or a prefix ending in ":". */
const CHAINS: Record<Exclude<FeatureKind, 'captions'>, { jobs: string[]; result: string }> = {
  avatar: { jobs: ['voice', 'avatar'], result: 'avatar' },
  translate: { jobs: ['translate:', 'avatar'], result: 'avatar' },
  motion: { jobs: ['motion'], result: 'motion' },
  restyle: { jobs: ['restyle-edit', 'restyle:'], result: 'restyle:' },
  swap: { jobs: ['swap:'], result: 'swap:' },
  remix: { jobs: ['remix-skeleton', 'remix:'], result: 'remix:' },
};
const matches = (job: string, name: string) => (name.endsWith(':') ? job.startsWith(name) : job === name);
/** The kinds that read a photo: the portrait that speaks, the character that moves. */
const READS_PHOTO: ReadonlySet<FeatureKind> = new Set(['avatar', 'translate', 'motion', 'remix']);

async function records(dir: string): Promise<JobRecord[]> {
  let text: string;
  try {
    text = await readFile(join(dir, 'smoke.jsonl'), 'utf8');
  } catch {
    throw new FeatureError([`${dir}: no smoke.jsonl (run smoke.ts with --out <this folder> first)`]);
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JobRecord)
    .filter((record) => record.kind === 'extension' && record.status === 'succeeded');
}

/** smoke.ts writes the workflow of each job as workflows/ext-<job>__<model>.api.json. */
const smokeWorkflow = async (dir: string, record: JobRecord) =>
  JSON.parse(await readFile(join(dir, 'workflows', `ext-${record.job.replace(':', '-')}__${record.model}.api.json`), 'utf8')) as ApiWorkflow;

const lastOutput = (record: JobRecord, ext: string) => [...(record.outputs ?? [])].reverse().find((file) => file.endsWith(ext));

/**
 * Bring a feature example into the showcase: the render of one smoke.ts call (its chain of jobs, each
 * with the workflow it ran), what it started from, and its HD pass. The file is re-encoded in the
 * showcase encoding with the AI-generated mention, its sound kept when it speaks; captions are burned
 * in as the Studio's export burns them.
 */
export async function ingestFeature(root: string, src: FeatureSources): Promise<{ added: string[]; replaced: string[] }> {
  const dir = join(root, SHOWCASE_DIR);
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(src.id)) throw new FeatureError([`--feature ${src.id}: must be kebab-case`]);
  const out = join(dir, featureFile(src.id));
  await mkdir(dirname(out), { recursive: true });
  await mkdir(join(dir, 'features', 'inputs'), { recursive: true });
  const workflows: ApiWorkflow[] = [];
  let entry: FeatureEntry;
  if (src.kind === 'captions') {
    entry = await burnCaptions(root, dir, manifest.features, src, workflows);
  } else {
    entry = await renderedFeature(library, dir, src, workflows);
  }
  for (const [index, workflow] of workflows.entries()) {
    const file = join(dir, featureWorkflowFile(src.id, index, entry.steps[index]!.model));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(workflow, null, 2)}\n`);
  }
  return writeFeature(join(dir, 'manifest.yaml'), entry);
}

/** A rendered example: its chain, its inputs, its HD pass, its file. */
async function renderedFeature(library: Library, dir: string, src: FeatureSources, workflows: ApiWorkflow[]): Promise<FeatureEntry> {
  const kind = src.kind as Exclude<FeatureKind, 'captions'>;
  const chain = CHAINS[kind];
  const jobs = await records(src.render);
  const problems: string[] = [];
  for (const name of chain.jobs) if (!jobs.some((record) => matches(record.job, name))) problems.push(`${src.render}: no successful ${name.replace(/:$/, '')} job`);
  const repeated = jobs.find((record, index) => jobs.findIndex((other) => other.job === record.job) !== index);
  if (repeated) problems.push(`${src.render}: ${repeated.job} ran twice (use one --out folder per smoke call)`);
  if (READS_PHOTO.has(kind) && !src.photo) problems.push(`a ${kind} example needs --photo, the photo its render read`);
  if (problems.length > 0) throw new FeatureError(problems);

  const steps = jobs.filter((record) => chain.jobs.some((name) => matches(record.job, name)));
  const result = steps.filter((record) => matches(record.job, chain.result)).at(-1)!;
  let rendered: string;
  if (kind === 'remix') {
    // The shots put back on the trend's frames: smoke.ts writes it as the app delivers it.
    const assembled = (await readdir(join(src.render, 'remix'))).filter((name) => name.endsWith('__remix.mp4'));
    if (assembled.length !== 1) throw new FeatureError([`${src.render}/remix: expected one assembled remix, found ${assembled.length}`]);
    rendered = join(src.render, 'remix', assembled[0]!);
  } else {
    const file = lastOutput(result, '.mp4');
    if (!file) throw new FeatureError([`${src.render}: the ${result.job} job has no clip`]);
    // A motion job lists the clip its LoadVideo echoes first, then its result (…__r1-1.mp4).
    rendered = join(src.render, file);
  }
  const info = await probe(rendered);
  const aspect = pickAspect(info.width, info.height);
  if (aspect !== '16:9' && aspect !== '9:16') throw new FeatureError([`${rendered}: ${info.width}x${info.height} is neither 16:9 nor 9:16`]);
  const speaks = SPEAKING_FEATURES.has(kind);
  if (speaks && !(await probeAudio(rendered))) throw new FeatureError([`${rendered}: a ${kind} example speaks, but the clip has no sound`]);

  const inputs: FeatureEntry['inputs'] = [];
  if (src.photo) {
    const sha = await sha256File(src.photo);
    if (result.image_sha256 && result.image_sha256 !== sha) throw new FeatureError([`${src.photo}: not the photo the ${result.job} job read (image_sha256 differs)`]);
    const file = featureInputFile(src.id, 'photo', extname(src.photo).slice(1).toLowerCase().replace('jpeg', 'jpg'));
    await copyFile(src.photo, join(dir, file));
    inputs.push({ role: 'photo', file, sha256: sha });
  }
  // The clip it followed, as smoke.ts prepared it (5 s or the trend at 16 fps, silent), in the showcase encoding.
  const source = kind === 'remix' ? join(src.render, 'inputs', 'remix', 'trend.mp4') : ['motion', 'restyle', 'swap'].includes(kind) ? join(src.render, 'inputs', 'motion.mp4') : null;
  if (source) {
    const size = await probe(source);
    const file = featureInputFile(src.id, 'clip', 'mp4');
    await normalizeClip(source, join(dir, file), { width: size.width, height: size.height, fps: FEATURE_FPS, tags: AI_METADATA });
    inputs.push({ role: 'clip', file, sha256: await sha256File(join(dir, file)) });
  }
  if (kind === 'restyle') {
    const edit = steps.find((record) => record.job === 'restyle-edit')!;
    const frame = lastOutput(edit, '.png');
    if (!frame) throw new FeatureError([`${src.render}: the restyle-edit job has no image`]);
    const file = featureInputFile(src.id, 'frame', 'png');
    await copyFile(join(src.render, frame), join(dir, file));
    inputs.push({ role: 'frame', file, sha256: await sha256File(join(dir, file)) });
  }

  for (const record of steps) workflows.push(await smokeWorkflow(src.render, record));
  const params = result.params ?? {};
  const voice = steps.find((record) => record.job === 'voice');
  const translate = steps.find((record) => record.job.startsWith('translate:'));
  const skeleton = steps.find((record) => record.job === 'remix-skeleton');
  const text =
    kind === 'avatar' ? voice?.params?.text : kind === 'restyle' || kind === 'swap' ? params.prompt : kind === 'remix' ? params.character : undefined;
  const language = kind === 'translate' ? translate!.job.slice('translate:'.length) : kind === 'avatar' ? voice?.params?.language : undefined;
  let post: FeatureEntry['post'];
  if (skeleton) {
    const file = lastOutput(skeleton, '.txt');
    if (file) {
      const { caption, hashtags } = parseTrendSkeleton(await readFile(join(src.render, file), 'utf8')).post;
      if (caption) post = { caption, hashtags: hashtags.slice(0, 12) };
    }
  }

  // The HD pass: SeedVR2 on this very render (by sha256), at the 1080p size of its aspect.
  let hd: FeatureEntry['hd'];
  let finalSource = rendered;
  let finalSize = dimensionsFor(aspect, '480p');
  let fps = FEATURE_FPS;
  if (src.hd) {
    const pass = (await records(src.hd.dir)).filter((record) => record.job === 'upscale');
    if (pass.length !== 1) throw new FeatureError([`${src.hd.dir}: expected one successful upscale job, found ${pass.length}`]);
    const upscale = pass[0]!;
    const input = upscale.inputs?.[0];
    if (!input) throw new FeatureError([`${src.hd.dir}: the upscale job names no clip`]);
    const sourceSha = await sha256File(rendered);
    const loaded = await sha256File(join(src.hd.inputs, input)).catch(() => null);
    if (loaded !== sourceSha) throw new FeatureError([`${src.hd.dir}: the clip it upscaled (${input}) is not ${rendered}`]);
    const target = UPSCALE_TARGETS[aspect];
    let output: string | undefined;
    for (const file of upscale.outputs ?? []) {
      if (!file.endsWith('.mp4')) continue;
      const size = await probe(join(src.hd.dir, file));
      if (size.width === target.width && size.height === target.height) output = join(src.hd.dir, file);
    }
    if (!output) throw new FeatureError([`${src.hd.dir}: no ${target.width}x${target.height} output`]);
    const smooth = upscale.params?.smooth === true;
    const seed = Number(upscale.params?.seed ?? 0);
    const workflow = hdWorkflow(library, { model: upscale.model, input, seed, smooth }, aspect);
    if (workflowSha256(workflow) !== workflowSha256(await smokeWorkflow(src.hd.dir, upscale))) {
      throw new FeatureError([`${src.hd.dir}: its workflow is not the one the showcase compiles for this pass`]);
    }
    hd = { model: upscale.model, seed, input, source_sha256: sourceSha, workflow_sha256: workflowSha256(workflow), rendered_at: upscale.at.slice(0, 10), smooth };
    finalSource = output;
    finalSize = target;
    fps = smooth ? SMOOTH_FPS : FEATURE_FPS;
  }
  const out = join(dir, featureFile(src.id));
  await normalizeClip(finalSource, out, { ...finalSize, fps, tags: AI_METADATA, audio: speaks });

  return {
    id: src.id,
    feature: kind,
    aspect,
    seed: Number(params.seed ?? 0),
    ...(typeof text === 'string' && text.trim() ? { text: text.trim() } : {}),
    ...(typeof language === 'string' ? { language } : {}),
    ...(src.face ? { face: src.face } : {}),
    ...(src.from ? { from: src.from } : {}),
    ...(post ? { post } : {}),
    inputs,
    steps: steps.map((record, index) => ({ model: record.model, workflow_sha256: workflowSha256(workflows[index]!) })),
    sha256: await sha256File(out),
    rendered_at: result.at.slice(0, 10),
    ...(hd ? { hd } : {}),
  };
}

/**
 * Captions burned into a talking example, as the Studio's export burns them: Whisper's words (the
 * transcription's smoke folder), aligned on the corrected text, drawn by libass in the chosen style
 * over the 9:16 frame, with the sound and the AI-generated mention.
 */
async function burnCaptions(root: string, dir: string, features: FeatureEntry[], src: FeatureSources, workflows: ApiWorkflow[]): Promise<FeatureEntry> {
  const from = features.find((entry) => entry.id === src.from);
  if (!from || !SPEAKING_FEATURES.has(from.feature) || from.feature === 'captions') {
    throw new FeatureError([`--from ${src.from ?? '(none)'}: captions burn into an avatar or a translation of the manifest`]);
  }
  if (!src.captions || !src.captions.text.trim() || !isCaptionStyle(src.captions.style)) {
    throw new FeatureError(['captions need --text and a --style of the captions editor']);
  }
  const transcribe = (await records(src.render)).filter((record) => record.job === 'transcribe');
  if (transcribe.length !== 1) throw new FeatureError([`${src.render}: expected one successful transcribe job, found ${transcribe.length}`]);
  const record = transcribe[0]!;
  const wordsFile = lastOutput(record, '.json');
  if (!wordsFile) throw new FeatureError([`${src.render}: the transcribe job has no words`]);
  const doc = parseWordsDoc(JSON.parse(await readFile(join(src.render, wordsFile), 'utf8')) as unknown);
  if (!isCaptionLanguage(doc.language)) throw new FeatureError([`${src.render}: Whisper heard "${doc.language}", a language captions are not made in`]);
  const clip = join(dir, featureFile(from.id));
  const duration_s = doc.duration_s > 0 ? doc.duration_s : (await probe(clip)).duration_s;
  const words = alignText(wordsFromChunks(doc.chunks, duration_s), src.captions.text.trim(), duration_s);
  const style = src.captions.style;
  const scratch = await mkdtemp(join(tmpdir(), 'montagio-feature-captions-'));
  const out = join(dir, featureFile(src.id));
  try {
    await writeFile(join(scratch, 'captions.ass'), buildAss({ language: doc.language, words }, style));
    await mkdir(join(scratch, 'fonts'), { recursive: true });
    const font = CAPTION_STYLES[style].font.file;
    await copyFile(join(root, 'apps', 'web', 'public', 'fonts', 'captions', font), join(scratch, 'fonts', font));
    await renderVertical(clip, out, { captions: { dir: scratch, ass: 'captions.ass', fonts: 'fonts' }, tags: AI_METADATA });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  workflows.push(await smokeWorkflow(src.render, record));
  return {
    id: src.id,
    feature: 'captions',
    aspect: '9:16',
    seed: 0,
    text: src.captions.text.trim(),
    language: doc.language,
    from: from.id,
    style,
    inputs: [],
    steps: [{ model: record.model, workflow_sha256: workflowSha256(workflows[0]!) }],
    sha256: await sha256File(out),
    rendered_at: record.at.slice(0, 10),
  };
}

/** Add or replace a feature example in the manifest, keeping its comments and layout. */
async function writeFeature(path: string, entry: FeatureEntry): Promise<{ added: string[]; replaced: string[] }> {
  const doc = parseDocument(await readFile(path, 'utf8'));
  let items = doc.get('features', true);
  if (!isSeq(items)) {
    items = new YAMLSeq();
    // Before withheld, which closes the manifest with its comment.
    doc.set('features', items);
  }
  const seq = items as YAMLSeq;
  seq.flow = false;
  const node = doc.createNode(entry);
  node.flow = true;
  const at = seq.items.findIndex((item) => isMap(item) && item.get('id') === entry.id);
  const file = featureFile(entry.id);
  if (at === -1) seq.items.push(node);
  else seq.items[at] = node;
  const text = doc.toString({ lineWidth: 0 });
  parseManifest(text, path);
  const partial = `${path}.part`;
  try {
    await writeFile(partial, text);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return at === -1 ? { added: [file], replaced: [] } : { added: [], replaced: [file] };
}
