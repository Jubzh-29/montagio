import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { compileJob, dimensionsFor, loadLibrary, type CompiledParams, type Preset } from '@montagio/presets';
import { AI_METADATA, normalizeClip } from '@montagio/sequence';
import { isMap, isSeq, parseDocument, YAMLSeq } from 'yaml';
import { clipFile, loadManifest, parseManifest, SHOWCASE_DIR, type ClipEntry } from './manifest';
import { sha256File } from './verify';
import { showcaseWorkflow, workflowSha256 } from './workflow';

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
 * the preset's own camera. Each clip is re-encoded in the showcase encoding with
 * the AI-generated mention, and its manifest entry ties it to its seed and to the
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

  let lines: string[];
  try {
    lines = (await readFile(join(smokeDir, 'smoke.jsonl'), 'utf8')).split(/\r?\n/).filter((line) => line.trim());
  } catch {
    throw new IngestError([`${smokeDir}: no smoke.jsonl (run smoke.ts with --out <this folder> first)`]);
  }
  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line) as SmokeRecord;
    } catch {
      throw new IngestError([`smoke.jsonl line ${index + 1}: not JSON`]);
    }
  });

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
      const { params } = compileJob(preset, model, template, { imageRef: posix.basename(sample.file), seed: record.seed, aspect: sample.aspect });
      const expected = cameraOf(params);
      if (!sameCamera(record.camera, expected)) {
        skipped.push(`${label}: its camera ${JSON.stringify(record.camera)} is not the preset's ${JSON.stringify(expected)}`);
      } else if (format(record) !== format(params)) {
        // A --resolution 720p render, say: normalizing would shrink it, and its workflow would not be the showcase's.
        skipped.push(`${label}: rendered at ${format(record)}; the preset makes ${format(params)} for ${sample.id}`);
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

  const { added, replaced } = await writeEntries(join(dir, 'manifest.yaml'), entries);
  return { added, replaced, skipped };
}

/** Add or replace clip entries in the manifest, keeping its comments and layout. */
async function writeEntries(path: string, entries: ClipEntry[]): Promise<{ added: string[]; replaced: string[] }> {
  const added: string[] = [];
  const replaced: string[] = [];
  if (entries.length === 0) return { added, replaced };
  const doc = parseDocument(await readFile(path, 'utf8'));
  let clips = doc.get('clips', true);
  if (!isSeq(clips)) {
    clips = new YAMLSeq();
    doc.set('clips', clips);
  }
  const seq = clips as YAMLSeq;
  seq.flow = false;
  for (const entry of entries) {
    const node = doc.createNode(entry);
    node.flow = true;
    const at = seq.items.findIndex((item) => isMap(item) && item.get('preset') === entry.preset && item.get('sample') === entry.sample);
    const file = clipFile(entry.preset, entry.sample);
    if (at === -1) {
      seq.items.push(node);
      added.push(file);
    } else {
      seq.items[at] = node;
      replaced.push(file);
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
