import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dimensionsFor, loadLibrary, UPSCALE_TARGETS, type ApiWorkflow, type CompiledParams, type Library, type Preset } from '@montagio/presets';
import { AI_METADATA, normalizeClip, probe } from '@montagio/sequence';
import { isMap, isSeq, parseDocument, YAMLSeq } from 'yaml';
import {
  clipFile,
  effectFile,
  exampleWorkflowFile,
  hookFile,
  loadManifest,
  parseManifest,
  SHOWCASE_DIR,
  withheldReason,
  type ClipEntry,
  type EffectExample,
  type HdPass,
  type HookExample,
  type Manifest,
  type RenderKind,
  type SampleEntry,
} from './manifest';
import { sha256File } from './verify';
import { hdWorkflow, showcaseJob, workflowSha256 } from './workflow';

/** The part of a smoke.jsonl record (infra/runpod/smoke.ts) that ingest reads. */
type SmokeRecord = {
  at: string;
  preset: string;
  model: string;
  run: number;
  status: string;
  camera: { mode: string; pose: string | null; pose_2: string | null; combine: string | null; speed: number | null };
  width: number;
  height: number;
  frames: number;
  fps: number;
  seed: number;
  outputs: string[];
  image?: string;
  image_sha256?: string;
  /** The text the model got: the photo's (--prompt), then the preset's. */
  prompt?: string;
  /** The negative prompt the model got: the preset's, or --negative's. */
  negative?: string;
};

export type IngestResult = { added: string[]; replaced: string[]; skipped: string[] };

export class IngestError extends Error {
  override name = 'IngestError';
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

const cameraOf = (params: CompiledParams) => ({
  mode: params.cameraMode,
  pose: params.cameraPose,
  pose_2: params.cameraPose2,
  combine: params.cameraCombine,
  speed: params.cameraSpeed,
});

/** A render's size and length, as smoke.ts records them and as a preset compiles them. */
const format = (v: { width: number; height: number; frames: number; fps: number }) =>
  `${v.width}x${v.height}, ${v.frames} frames at ${v.fps} fps`;

const sameCamera = (a: SmokeRecord['camera'] | undefined, b: ReturnType<typeof cameraOf>) =>
  !!a && a.mode === b.mode && a.pose === b.pose && a.pose_2 === b.pose_2 && a.combine === b.combine && a.speed === b.speed;

/** What a camera run vouches for in its manifest entry: its seed, texts, photo and workflow. */
type CameraFields = Pick<ClipEntry, 'seed' | 'description' | 'negative' | 'image_sha256' | 'workflow_sha256' | 'rendered_at'>;

/**
 * A successful camera run of smoke.ts against the showcase: made from the sample's exact photo,
 * on the manifest's model, with the preset's own camera, size and length, and with a
 * description of the photo before the preset's text. That description, when it is not the
 * sample's prompt, and a negative that replaced the preset's are kept in the entry, so that
 * the workflow it vouches for is the one that rendered the clip.
 */
function checkCameraRun(
  library: Library,
  manifest: Manifest,
  record: SmokeRecord,
  sample: SampleEntry,
  sampleSha: string,
): { preset: Preset; fields: CameraFields } | { skip: string } {
  const label = `${record.preset} run ${record.run}`;
  const preset = library.presets.get(record.preset);
  if (!preset) return { skip: `${label}: preset "${record.preset}" is not in the library` };
  if (record.image_sha256 !== sampleSha) return { skip: `${label}: made from another image (${record.image ?? 'not recorded'}), not ${sample.file}` };
  if (record.model !== manifest.model) return { skip: `${label}: rendered on ${record.model}, the showcase shows ${manifest.model}` };
  const { params } = showcaseJob(library, manifest, preset, sample, record.seed);
  const expected = cameraOf(params);
  if (!sameCamera(record.camera, expected)) {
    return { skip: `${label}: its camera ${JSON.stringify(record.camera)} is not the preset's ${JSON.stringify(expected)}` };
  }
  if (format(record) !== format(params)) {
    // A --resolution 720p render, say: normalizing would shrink it, and its workflow would not be the showcase's.
    return { skip: `${label}: rendered at ${format(record)}; the preset makes ${format(params)} for ${sample.id}` };
  }
  // smoke.ts joins the photo's text (--prompt) and the preset's with ", ".
  const text = record.prompt ?? '';
  const suffix = preset.prompt.suffix.trim();
  const description = !suffix ? text : text === suffix ? '' : text.endsWith(`, ${suffix}`) ? text.slice(0, -(suffix.length + 2)) : null;
  if (description === '' && sample.prompt) {
    // Rendered without the photo's text (smoke --prompt), the clip is the ghost of the first GPU render.
    return { skip: `${label}: rendered without a description of the photo (the text was ${JSON.stringify(text)}); run smoke.ts with --prompt` };
  }
  const texts = {
    ...(description && description !== sample.prompt ? { description } : {}),
    ...(record.negative !== undefined && record.negative !== params.negative ? { negative: record.negative } : {}),
  };
  const job = description === null ? null : showcaseJob(library, manifest, preset, sample, record.seed, texts);
  if (!job || job.params.prompt !== record.prompt) {
    return { skip: `${label}: rendered from the text ${JSON.stringify(record.prompt ?? null)}, which does not end with the preset's ${JSON.stringify(suffix)}` };
  }
  if (!record.outputs?.[0]) return { skip: `${label}: no output file` };
  return {
    preset,
    fields: {
      seed: record.seed,
      ...texts,
      image_sha256: sampleSha,
      workflow_sha256: workflowSha256(job.workflow),
      rendered_at: record.at.slice(0, 10),
    },
  };
}

/**
 * Bring the clips of a GPU session into the showcase: the successful runs of
 * `smoke.ts` that `checkCameraRun` accepts for `sampleId`, except the withheld
 * ones. Each clip is re-encoded in the showcase encoding with the AI-generated
 * mention, and its manifest entry ties it to its seed, its texts and the
 * workflow that rendered it. `picks` chooses among several runs of one preset.
 */
export async function ingestSmoke(
  root: string,
  smokeDir: string,
  sampleId: string,
  picks: Record<string, number>,
): Promise<IngestResult> {
  const dir = join(root, SHOWCASE_DIR);
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const sample = manifest.samples.find((candidate) => candidate.id === sampleId);
  if (!sample) {
    throw new IngestError([`unknown sample "${sampleId}" (the manifest has ${manifest.samples.map((s) => s.id).join(', ')})`]);
  }
  const model = library.models.get(manifest.model);
  const template = model ? library.templates.get(model.workflow) : undefined;
  if (!model || !template) throw new IngestError([`the showcase model "${manifest.model}" is not in the registry`]);

  const records = (await readSmoke(smokeDir)) as SmokeRecord[];

  const sampleSha = await sha256File(join(dir, sample.file));
  const skipped: string[] = [];
  const runsByPreset = new Map<string, { record: SmokeRecord; fields: CameraFields }[]>();
  for (const record of records) {
    if (record.status !== 'succeeded') continue;
    const checked = checkCameraRun(library, manifest, record, sample, sampleSha);
    const withheld = withheldReason(manifest, 'clip', record.preset, sample.id);
    if ('skip' in checked) skipped.push(checked.skip);
    else if (withheld) skipped.push(`${record.preset} run ${record.run}: withheld from the showcase on ${sample.id} (${withheld})`);
    else runsByPreset.set(record.preset, [...(runsByPreset.get(record.preset) ?? []), { record, fields: checked.fields }]);
  }

  const problems: string[] = [];
  const chosen: { preset: Preset; record: SmokeRecord; fields: CameraFields }[] = [];
  for (const [presetId, pick] of Object.entries(picks)) {
    if (!runsByPreset.has(presetId)) problems.push(`--pick ${presetId}=${pick}: no successful run of ${presetId} for ${sample.id}`);
  }
  for (const preset of library.presets.values()) {
    const runs = runsByPreset.get(preset.id);
    if (!runs) continue;
    const listing = runs.map(({ record: r }) => `  run ${r.run}, seed ${r.seed}, ${r.outputs[0]}`).join('\n');
    const pick = picks[preset.id];
    if (pick !== undefined) {
      const matches = runs.filter((r) => r.record.run === pick);
      if (matches.length === 1) chosen.push({ preset, ...matches[0]! });
      // smoke.ts numbers runs from 1 on every call: one folder per call keeps them apart.
      else problems.push(`${preset.id}: ${matches.length === 0 ? `no run ${pick}` : `run ${pick} appears ${matches.length} times (use one --out folder per smoke call)`}:\n${listing}`);
    } else if (runs.length > 1) {
      problems.push(`${preset.id}: ${runs.length} successful runs, choose one with --pick ${preset.id}=<run>:\n${listing}`);
    } else {
      chosen.push({ preset, ...runs[0]! });
    }
  }
  if (problems.length > 0) throw new IngestError(problems);

  const entries: ClipEntry[] = [];
  for (const { preset, record, fields } of chosen) {
    const out = join(dir, clipFile(preset.id, sample.id));
    await mkdir(dirname(out), { recursive: true });
    const size = dimensionsFor(sample.aspect, preset.defaults.resolution);
    await normalizeClip(join(smokeDir, record.outputs[0]!), out, { ...size, fps: preset.defaults.fps, tags: AI_METADATA });
    const { seed, description, negative, ...rest } = fields;
    entries.push({
      preset: preset.id,
      sample: sample.id,
      seed,
      ...(description !== undefined ? { description } : {}),
      ...(negative !== undefined ? { negative } : {}),
      sha256: await sha256File(out),
      ...rest,
    });
  }

  const { added, replaced } = await writeEntries(join(dir, 'manifest.yaml'), [
    { section: 'clips', idKey: 'preset', fileOf: clipFile, entries: entries.map((entry) => ({ ...entry, id: entry.preset })) },
  ]);
  return { added, replaced, skipped };
}

/** The part of an extension record of smoke.jsonl (infra/runpod/smoke.ts) that ingest reads. */
type ExtensionRun = {
  kind?: string;
  at: string;
  /** "effect:squish", "transition:iris-dive"; a hook's clip is its transition. */
  job: string;
  model: string;
  run: number;
  status: string;
  params?: { width?: number; height?: number; seed?: number };
  /** The files the job loaded, by name: an upscale's clip (--clip), an effect's photo. */
  inputs?: string[];
  outputs?: string[];
  image_sha256?: string | null;
};

/** Effects and transitions render at 480p and 16 fps (Wan 2.1 I2V, Wan 2.2 FLF2V). */
const EXAMPLE_FPS = 16;

/**
 * Bring the effect and hook examples of a GPU session into the showcase: the successful
 * `effect:<id>` and `transition:<hook>` runs of `smoke.ts --extension` made from `sampleId`'s
 * exact photo. Each clip is re-encoded in the showcase encoding with the AI-generated mention,
 * its workflow is kept for "Open in ComfyUI", and its manifest entry ties it to its seed.
 * `picks` chooses among several runs of one job ({ "effect:squish": 2 }).
 */
export async function ingestExamples(
  root: string,
  smokeDir: string,
  sampleId: string,
  picks: Record<string, number>,
): Promise<IngestResult> {
  const dir = join(root, SHOWCASE_DIR);
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const sample = manifest.samples.find((candidate) => candidate.id === sampleId);
  if (!sample) {
    throw new IngestError([`unknown sample "${sampleId}" (the manifest has ${manifest.samples.map((s) => s.id).join(', ')})`]);
  }
  const records = (await readSmoke(smokeDir)) as ExtensionRun[];
  const sampleSha = await sha256File(join(dir, sample.file));
  const size = dimensionsFor(sample.aspect, '480p');
  const skipped: string[] = [];
  const runsByJob = new Map<string, { kind: 'effect' | 'hook'; id: string; runs: ExtensionRun[] }>();
  for (const record of records) {
    const match = /^(effect|transition):([a-z0-9-]+)$/.exec(record.kind === 'extension' ? record.job : '');
    if (!match || record.status !== 'succeeded') continue;
    const kind = match[1] === 'effect' ? 'effect' : 'hook';
    const id = match[2]!;
    const label = `${record.job} run ${record.run}`;
    const { width, height } = record.params ?? {};
    const withheld = withheldReason(manifest, kind, id, sample.id);
    if (!(kind === 'effect' ? library.effects : library.hooks).has(id)) {
      skipped.push(`${label}: "${id}" is not ${kind === 'effect' ? 'an effect' : 'a hook'} of the library`);
    } else if (withheld) {
      skipped.push(`${label}: withheld from the showcase on ${sample.id} (${withheld})`);
    } else if (record.image_sha256 !== sampleSha) {
      skipped.push(`${label}: made from another image, not ${sample.file}`);
    } else if (width !== size.width || height !== size.height) {
      skipped.push(`${label}: rendered at ${width}x${height}; the showcase shows ${size.width}x${size.height} for ${sample.id}`);
    } else if (!record.outputs?.[0]) {
      skipped.push(`${label}: no output file`);
    } else {
      const entry = runsByJob.get(record.job) ?? { kind, id, runs: [] };
      entry.runs.push(record);
      runsByJob.set(record.job, entry);
    }
  }

  const problems: string[] = [];
  for (const [job, pick] of Object.entries(picks)) {
    if (!runsByJob.has(job)) problems.push(`--pick ${job}=${pick}: no successful run of ${job} for ${sample.id}`);
  }
  const chosen: { kind: 'effect' | 'hook'; id: string; record: ExtensionRun }[] = [];
  for (const [job, { kind, id, runs }] of runsByJob) {
    const listing = runs.map((r) => `  run ${r.run}, seed ${r.params?.seed ?? '?'}, ${r.outputs?.[0]}`).join('\n');
    const pick = picks[job];
    if (pick !== undefined) {
      const matches = runs.filter((r) => r.run === pick);
      if (matches.length === 1) chosen.push({ kind, id, record: matches[0]! });
      else problems.push(`${job}: ${matches.length === 0 ? `no run ${pick}` : `run ${pick} appears ${matches.length} times (use one --out folder per smoke call)`}:\n${listing}`);
    } else if (runs.length > 1) {
      // Every extension record is run 1, and the folder holds one workflow per job: two calls shared it.
      problems.push(`${job}: ${runs.length} successful runs in one folder; use one --out folder per smoke call and ingest the one to keep:\n${listing}`);
    } else {
      chosen.push({ kind, id, record: runs[0]! });
    }
  }
  if (problems.length > 0) throw new IngestError(problems);

  const effects: (EffectExample & { id: string })[] = [];
  const hooks: (HookExample & { id: string })[] = [];
  for (const { kind, id, record } of chosen) {
    const out = join(dir, kind === 'effect' ? effectFile(id, sample.id) : hookFile(id, sample.id));
    await mkdir(dirname(out), { recursive: true });
    await normalizeClip(join(smokeDir, record.outputs![0]!), out, { ...size, fps: EXAMPLE_FPS, tags: AI_METADATA });
    // smoke.ts writes the workflow of each job as workflows/ext-<job>__<model>.api.json.
    const smokeWorkflow = join(smokeDir, 'workflows', `ext-${record.job.replace(':', '-')}__${record.model}.api.json`);
    const workflow = JSON.parse(await readFile(smokeWorkflow, 'utf8')) as ApiWorkflow;
    const workflowOut = join(dir, exampleWorkflowFile(kind, id, sample.id));
    await mkdir(dirname(workflowOut), { recursive: true });
    await writeFile(workflowOut, `${JSON.stringify(workflow, null, 2)}\n`);
    const fields = {
      sample: sample.id,
      seed: record.params?.seed ?? 0,
      sha256: await sha256File(out),
      image_sha256: sampleSha,
      workflow_sha256: workflowSha256(workflow),
      rendered_at: record.at.slice(0, 10),
    };
    if (kind === 'effect') effects.push({ id, effect: id, ...fields });
    else hooks.push({ id, hook: id, ...fields });
  }

  const { added, replaced } = await writeEntries(join(dir, 'manifest.yaml'), [
    { section: 'effects', idKey: 'effect', fileOf: effectFile, entries: effects },
    { section: 'hooks', idKey: 'hook', fileOf: hookFile, entries: hooks },
  ]);
  return { added, replaced, skipped };
}

/** Where the clips an upscale run took can be found and traced back to their photo. */
export type HdSources = {
  /** The folder holding each clip the run upscaled, under the name the run loaded it (smoke.ts --clip). */
  inputs: string;
  /** smoke.ts results folders of camera runs whose outputs were upscaled as they came out. */
  renders: string[];
};

/** A render of the showcase an upscale run may have taken: its entry, without its file's sha256 and HD pass. */
type HdTarget = { kind: RenderKind; id: string; sample: SampleEntry; base: { id: string; sample: string } & Record<string, unknown> };

const SECTION = { clip: 'clips', effect: 'effects', hook: 'hooks' } as const;
const ID_KEY = { clip: 'preset', effect: 'effect', hook: 'hook' } as const;
const FILE_OF = { clip: clipFile, effect: effectFile, hook: hookFile } as const;

/** An entry with its fields in the manifest's order: the file's sha256 before the photo's, the HD pass last. */
function withFile(base: { sample: string } & Record<string, unknown>, sha256: string, hd: HdPass): { sample: string } & Record<string, unknown> {
  const { image_sha256, workflow_sha256, rendered_at, ...head } = base;
  return { ...head, sha256, image_sha256, workflow_sha256, rendered_at, hd };
}

/**
 * Bring the 1080p pass of a GPU session into the showcase: the successful runs of
 * `smoke.ts --extension upscale --clip <480p clip>` whose clip is a rendered clip or an
 * example of the showcase as ingest wrote it, or the output of a camera run of
 * `sources.renders` that `checkCameraRun` accepts. smoke.jsonl names the upscaled clip
 * without its sha256, so the chain photo → 480p run → upscale run is checked on the bytes of
 * the copy in `sources.inputs`. Each 1080p output is re-encoded in the showcase encoding with
 * the AI-generated mention and takes the place of the 480p file; its entry keeps what ties
 * the 480p render to its photo, seed and workflow, and adds the `hd` pass.
 */
export async function ingestHd(root: string, smokeDir: string, sources: HdSources): Promise<IngestResult> {
  const dir = join(root, SHOWCASE_DIR);
  const [library, manifest] = await Promise.all([loadLibrary(root), loadManifest(root)]);
  const records = ((await readSmoke(smokeDir)) as ExtensionRun[]).filter((r) => r.kind === 'extension' && r.job === 'upscale' && r.status === 'succeeded');
  const samples = new Map(manifest.samples.map((sample) => [sample.id, sample]));
  const sampleBySha = new Map<string, SampleEntry>();
  for (const sample of manifest.samples) sampleBySha.set(await sha256File(join(dir, sample.file)), sample);

  // The 480p files of the showcase, by sha256: an entry with an HD pass remembers the clip it took.
  const known = new Map<string, HdTarget>();
  const entries = [
    ...manifest.clips.map((entry) => ({ kind: 'clip' as const, id: entry.preset, entry })),
    ...manifest.effects.map((entry) => ({ kind: 'effect' as const, id: entry.effect, entry })),
    ...manifest.hooks.map((entry) => ({ kind: 'hook' as const, id: entry.hook, entry })),
  ];
  for (const { kind, id, entry } of entries) {
    const { sha256, hd, ...base } = entry;
    known.set(hd ? hd.source_sha256 : sha256, { kind, id, sample: samples.get(entry.sample)!, base: { id, ...base } });
  }
  // The outputs of the camera runs, by sha256, checked only when an upscale took one.
  const rendered = new Map<string, SmokeRecord>();
  for (const folder of sources.renders) {
    for (const record of (await readSmoke(folder)) as SmokeRecord[]) {
      if ((record as { kind?: string }).kind !== undefined || record.status !== 'succeeded' || !record.outputs?.[0]) continue;
      try {
        rendered.set(await sha256File(join(folder, record.outputs[0])), record);
      } catch {
        // a clip that did not come down with its folder: no upscale can be traced to it
      }
    }
  }

  const skipped: string[] = [];
  const problems: string[] = [];
  const chosen = new Map<string, { target: HdTarget; record: ExtensionRun; input: string; inputSha: string; output: string; fps: number }>();
  for (const record of records) {
    const input = record.inputs?.[0];
    const label = `upscale of ${input ?? '(no clip)'}`;
    if (!input) {
      skipped.push(`${label}: the record names no clip`);
      continue;
    }
    let inputSha: string;
    try {
      inputSha = await sha256File(join(sources.inputs, input));
    } catch {
      skipped.push(`${label}: no ${input} in ${sources.inputs}, so it cannot be traced to a render`);
      continue;
    }
    let target = known.get(inputSha);
    const camera = target ? undefined : rendered.get(inputSha);
    if (camera) {
      const sample = camera.image_sha256 ? sampleBySha.get(camera.image_sha256) : undefined;
      const checked = sample ? checkCameraRun(library, manifest, camera, sample, camera.image_sha256!) : { skip: `${camera.preset} run ${camera.run}: made from none of the sample photos` };
      if ('skip' in checked) {
        skipped.push(`${label}: its clip is the render of ${checked.skip}`);
        continue;
      }
      const { seed, description, negative, ...rest } = checked.fields;
      const base = { id: checked.preset.id, preset: checked.preset.id, sample: sample!.id, seed, ...(description !== undefined ? { description } : {}), ...(negative !== undefined ? { negative } : {}), ...rest };
      target = { kind: 'clip', id: checked.preset.id, sample: sample!, base };
    }
    if (!target) {
      skipped.push(`${label}: its clip is neither a render of the showcase nor the output of a camera run of --renders`);
      continue;
    }
    const pair = `${target.id} × ${target.sample.id}`;
    const withheld = withheldReason(manifest, target.kind, target.id, target.sample.id);
    const model = library.extensionModels.get(record.model);
    const size = UPSCALE_TARGETS[target.sample.aspect];
    const fps = target.kind === 'clip' ? library.presets.get(target.id)?.defaults.fps : EXAMPLE_FPS;
    if (withheld) {
      skipped.push(`${label} (${pair}): withheld from the showcase (${withheld})`);
      continue;
    }
    if (fps === undefined) {
      skipped.push(`${label} (${pair}): preset "${target.id}" is not in the library`);
      continue;
    }
    if (model?.task !== 'v2v-upscale') {
      skipped.push(`${label} (${pair}): "${record.model}" is not a clip upscaler of the registry`);
      continue;
    }
    if (record.params?.width !== size.width || record.params?.height !== size.height || record.params?.seed === undefined) {
      skipped.push(`${label} (${pair}): rendered at ${record.params?.width}x${record.params?.height}; the HD pass makes ${size.width}x${size.height} for ${target.sample.id}`);
      continue;
    }
    // smoke.ts lists the clip it uploaded among the outputs: the 1080p file is the one at the HD size.
    let output: string | undefined;
    for (const candidate of record.outputs ?? []) {
      const info = await probe(join(smokeDir, candidate)).catch(() => null);
      if (info?.width === size.width && info.height === size.height) output = candidate;
    }
    if (!output) {
      skipped.push(`${label} (${pair}): no ${size.width}x${size.height} output`);
      continue;
    }
    const key = `${target.kind}:${pair}`;
    const previous = chosen.get(key);
    if (previous) {
      problems.push(`${target.kind} ${pair}: upscaled twice in ${smokeDir} (${previous.input}, ${input}); ingest the folder of the pass to keep alone`);
      continue;
    }
    chosen.set(key, { target, record, input, inputSha, output, fps });
  }
  if (problems.length > 0) throw new IngestError(problems);

  const groups: EntryGroup[] = (['clip', 'effect', 'hook'] as const).map((kind) => ({ section: SECTION[kind], idKey: ID_KEY[kind], fileOf: FILE_OF[kind], entries: [] }));
  for (const { target, record, input, inputSha, output, fps } of chosen.values()) {
    const out = join(dir, FILE_OF[target.kind](target.id, target.sample.id));
    await mkdir(dirname(out), { recursive: true });
    const size = UPSCALE_TARGETS[target.sample.aspect];
    await normalizeClip(join(smokeDir, output), out, { ...size, fps, tags: AI_METADATA });
    const pass = { model: record.model, seed: record.params!.seed!, input };
    const hd: HdPass = {
      ...pass,
      source_sha256: inputSha,
      workflow_sha256: workflowSha256(hdWorkflow(library, pass, target.sample.aspect)),
      rendered_at: record.at.slice(0, 10),
    };
    const { id, ...base } = target.base;
    groups.find((group) => group.idKey === ID_KEY[target.kind])!.entries.push({ id, ...withFile(base, await sha256File(out), hd) });
  }
  const { added, replaced } = await writeEntries(join(dir, 'manifest.yaml'), groups);
  return { added, replaced, skipped };
}

/** The records of a smoke.ts results folder, one per line of its smoke.jsonl. */
async function readSmoke(smokeDir: string): Promise<unknown[]> {
  let lines: string[];
  try {
    lines = (await readFile(join(smokeDir, 'smoke.jsonl'), 'utf8')).split(/\r?\n/).filter((line) => line.trim());
  } catch {
    throw new IngestError([`${smokeDir}: no smoke.jsonl (run smoke.ts with --out <this folder> first)`]);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new IngestError([`smoke.jsonl line ${index + 1}: not JSON`]);
    }
  });
}

type EntryGroup = {
  section: 'clips' | 'effects' | 'hooks';
  /** The key that names the preset, effect or hook of an entry. */
  idKey: 'preset' | 'effect' | 'hook';
  fileOf: (id: string, sample: string) => string;
  entries: ({ id: string; sample: string } & Record<string, unknown>)[];
};

/** Add or replace entries in the manifest, keeping its comments and layout. */
async function writeEntries(path: string, groups: EntryGroup[]): Promise<{ added: string[]; replaced: string[] }> {
  const added: string[] = [];
  const replaced: string[] = [];
  if (groups.every((group) => group.entries.length === 0)) return { added, replaced };
  const doc = parseDocument(await readFile(path, 'utf8'));
  for (const { section, idKey, fileOf, entries } of groups) {
    if (entries.length === 0) continue;
    let items = doc.get(section, true);
    if (!isSeq(items)) {
      items = new YAMLSeq();
      doc.set(section, items);
    }
    const seq = items as YAMLSeq;
    seq.flow = false;
    for (const { id, ...entry } of entries) {
      const node = doc.createNode(entry);
      node.flow = true;
      const at = seq.items.findIndex((item) => isMap(item) && item.get(idKey) === id && item.get('sample') === entry.sample);
      const file = fileOf(id, entry.sample);
      if (at === -1) {
        seq.items.push(node);
        added.push(file);
      } else {
        seq.items[at] = node;
        replaced.push(file);
      }
    }
  }
  const text = doc.toString({ lineWidth: 0 });
  parseManifest(text, path);
  const partial = `${path}.part`;
  try {
    await writeFile(partial, text);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return { added, replaced };
}
