import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dimensionsFor, loadLibrary, type ApiWorkflow, type CompiledParams, type Preset } from '@montagio/presets';
import { AI_METADATA, normalizeClip } from '@montagio/sequence';
import { isMap, isSeq, parseDocument, YAMLSeq } from 'yaml';
import {
  clipFile,
  effectFile,
  exampleWorkflowFile,
  hookFile,
  loadManifest,
  parseManifest,
  SHOWCASE_DIR,
  type ClipEntry,
  type EffectExample,
  type HookExample,
} from './manifest';
import { sha256File } from './verify';
import { showcaseJob, showcaseWorkflow, workflowSha256 } from './workflow';

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

/**
 * Bring the clips of a GPU session into the showcase: the successful runs of
 * `smoke.ts` made from `sampleId`'s exact photo, on the manifest's model, with
 * the preset's own camera and the photo's text before the preset's. Each clip
 * is re-encoded in the showcase encoding with the AI-generated mention, and its
 * manifest entry ties it to its seed and to the workflow that rendered it.
 * `picks` chooses among several runs of one preset.
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
  const runsByPreset = new Map<string, SmokeRecord[]>();
  for (const record of records) {
    if (record.status !== 'succeeded') continue;
    const label = `${record.preset} run ${record.run}`;
    const preset = library.presets.get(record.preset);
    if (!preset) {
      skipped.push(`${label}: preset "${record.preset}" is not in the library`);
    } else if (record.image_sha256 !== sampleSha) {
      skipped.push(`${label}: made from another image (${record.image ?? 'not recorded'}), not ${sample.file}`);
    } else if (record.model !== manifest.model) {
      skipped.push(`${label}: rendered on ${record.model}, the showcase shows ${manifest.model}`);
    } else {
      const { params } = showcaseJob(library, manifest, preset, sample, record.seed);
      const expected = cameraOf(params);
      if (!sameCamera(record.camera, expected)) {
        skipped.push(`${label}: its camera ${JSON.stringify(record.camera)} is not the preset's ${JSON.stringify(expected)}`);
      } else if (format(record) !== format(params)) {
        // A --resolution 720p render, say: normalizing would shrink it, and its workflow would not be the showcase's.
        skipped.push(`${label}: rendered at ${format(record)}; the preset makes ${format(params)} for ${sample.id}`);
      } else if (record.prompt !== params.prompt) {
        // Rendered without the photo's text (smoke --prompt), the clip is the ghost of the first GPU render;
        // with another text, its workflow is not the one the manifest would vouch for.
        skipped.push(`${label}: rendered from the text ${JSON.stringify(record.prompt ?? null)}; the showcase compiles ${JSON.stringify(params.prompt)} for ${sample.id}`);
      } else if (!record.outputs?.[0]) {
        skipped.push(`${label}: no output file`);
      } else {
        runsByPreset.set(record.preset, [...(runsByPreset.get(record.preset) ?? []), record]);
      }
    }
  }

  const problems: string[] = [];
  const chosen: { preset: Preset; record: SmokeRecord }[] = [];
  for (const [presetId, pick] of Object.entries(picks)) {
    if (!runsByPreset.has(presetId)) problems.push(`--pick ${presetId}=${pick}: no successful run of ${presetId} for ${sample.id}`);
  }
  for (const preset of library.presets.values()) {
    const runs = runsByPreset.get(preset.id);
    if (!runs) continue;
    const listing = runs.map((r) => `  run ${r.run}, seed ${r.seed}, ${r.outputs[0]}`).join('\n');
    const pick = picks[preset.id];
    if (pick !== undefined) {
      const matches = runs.filter((r) => r.run === pick);
      if (matches.length === 1) chosen.push({ preset, record: matches[0]! });
      // smoke.ts numbers runs from 1 on every call: one folder per call keeps them apart.
      else problems.push(`${preset.id}: ${matches.length === 0 ? `no run ${pick}` : `run ${pick} appears ${matches.length} times (use one --out folder per smoke call)`}:\n${listing}`);
    } else if (runs.length > 1) {
      problems.push(`${preset.id}: ${runs.length} successful runs, choose one with --pick ${preset.id}=<run>:\n${listing}`);
    } else {
      chosen.push({ preset, record: runs[0]! });
    }
  }
  if (problems.length > 0) throw new IngestError(problems);

  const entries: ClipEntry[] = [];
  for (const { preset, record } of chosen) {
    const out = join(dir, clipFile(preset.id, sample.id));
    await mkdir(dirname(out), { recursive: true });
    const size = dimensionsFor(sample.aspect, preset.defaults.resolution);
    await normalizeClip(join(smokeDir, record.outputs[0]!), out, { ...size, fps: preset.defaults.fps, tags: AI_METADATA });
    entries.push({
      preset: preset.id,
      sample: sample.id,
      seed: record.seed,
      sha256: await sha256File(out),
      image_sha256: sampleSha,
      workflow_sha256: workflowSha256(showcaseWorkflow(library, manifest, preset, sample, record.seed)),
      rendered_at: record.at.slice(0, 10),
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
    if (!(kind === 'effect' ? library.effects : library.hooks).has(id)) {
      skipped.push(`${label}: "${id}" is not ${kind === 'effect' ? 'an effect' : 'a hook'} of the library`);
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
