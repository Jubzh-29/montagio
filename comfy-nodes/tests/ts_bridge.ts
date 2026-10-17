// SPDX-License-Identifier: GPL-3.0-only
// Test bridge: answers the pack's parity tests with the app's own code (@montagio/presets).
// Request on stdin : { root, cases: [{ name, yaml }], compile: [CompileReq] }
// Response on stdout (JSON only) : { constants, cases: [{ name, ok, preset?, error? }], compile: [params | { error }] }
// compile[i] answers compile[i] of the request: the params of the app's compileJob (workflow template of the
// model taken from the library under `root`, start image "x.png", seed 1), or { error } for a CompileError.
// Run from the monorepo root through tsx, see tests/bridge.py.
import {
  CAMERA_POSE_PROMPTS,
  CAMERA_POSE_VALUES,
  CAMERA_POSES,
  compileJob,
  CompileError,
  dimensionsFor,
  frameCount,
  loadLibrary,
  parsePreset,
  pickAspect,
  PresetError,
  type Aspect,
  type CompiledParams,
  type Library,
  type Resolution,
} from '@montagio/presets';

type CompileReq = {
  preset_yaml: string;
  model: string; // id of a model of the library
  aspect: Aspect;
  resolution?: Resolution; // left out: the preset's own
  userPrompt?: string;
};

type Request = {
  root: string; // library root, for the compiler requests
  cases: { name: string; yaml: string }[];
  compile: CompileReq[];
};

const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1'];
const RESOLUTIONS: Resolution[] = ['480p', '720p'];
const FPS = [16, 24];
// widths x heights around the thresholds of pickAspect (ratio 1.4 and 0.71)
const IMAGE_SIZES: [number, number][] = [
  [1920, 1080], [1080, 1920], [1000, 1000], [4000, 3000], [3000, 4000], [1400, 1000], [1399, 1000],
  [1000, 1400], [710, 1000], [711, 1000], [1, 1], [100, 1000], [1000, 100],
];

function constants() {
  const dimensions: Record<string, Record<string, { width: number; height: number }>> = {};
  for (const aspect of ASPECTS) {
    dimensions[aspect] = {};
    for (const resolution of RESOLUTIONS) dimensions[aspect][resolution] = dimensionsFor(aspect, resolution);
  }
  // frameCount[duration_s][fps]
  const frames: Record<string, Record<string, number>> = {};
  for (let duration = 2; duration <= 10; duration++) {
    frames[duration] = {};
    for (const fps of FPS) frames[duration][fps] = frameCount(duration, fps);
  }
  return {
    CAMERA_POSES: [...CAMERA_POSES],
    CAMERA_POSE_VALUES,
    CAMERA_POSE_PROMPTS,
    dimensions,
    frameCount: frames,
    pickAspect: IMAGE_SIZES.map(([width, height]) => ({ width, height, aspect: pickAspect(width, height) })),
  };
}

function parseCase({ name, yaml }: { name: string; yaml: string }) {
  try {
    return { name, ok: true, preset: parsePreset(yaml, name) };
  } catch (error) {
    if (error instanceof PresetError) return { name, ok: false, error: error.message };
    throw error;
  }
}

function compileCase(library: Library, req: CompileReq): CompiledParams | { error: string } {
  // a bad request is a bug of the test: it crashes the bridge, only the compiler's refusals are answers
  const preset = parsePreset(req.preset_yaml, 'compile request');
  const model = library.models.get(req.model);
  if (!model) throw new Error(`compile request: unknown model "${req.model}"`);
  const template = library.templates.get(model.workflow);
  if (!template) throw new Error(`compile request: no workflow template for model "${req.model}"`);
  try {
    const inputs = { imageRef: 'x.png', seed: 1, aspect: req.aspect, resolution: req.resolution, userPrompt: req.userPrompt };
    return compileJob(preset, model, template, inputs).params;
  } catch (error) {
    if (error instanceof CompileError) return { error: error.message };
    throw error;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const request = JSON.parse(await readStdin()) as Request;
const library = request.compile.length > 0 ? await loadLibrary(request.root) : undefined;
const compiled = library ? request.compile.map((req) => compileCase(library, req)) : [];

process.stdout.write(JSON.stringify({ constants: constants(), cases: request.cases.map(parseCase), compile: compiled }));
