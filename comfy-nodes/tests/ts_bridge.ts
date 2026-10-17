// SPDX-License-Identifier: GPL-3.0-only
// Test bridge: answers the pack's parity tests with the app's own code (@montagio/presets).
// Request on stdin : { root, cases: [{ name, yaml }], compile: [] }
// Response on stdout (JSON only) : { constants, cases: [{ name, ok, preset?, error? }], compile: [] }
// Run from the monorepo root through tsx, see tests/bridge.py.
import {
  CAMERA_POSE_PROMPTS,
  CAMERA_POSE_VALUES,
  CAMERA_POSES,
  dimensionsFor,
  frameCount,
  parsePreset,
  pickAspect,
  PresetError,
  type Aspect,
  type Resolution,
} from '@montagio/presets';

type Request = {
  root: string; // library root, for the compiler requests
  cases: { name: string; yaml: string }[];
  compile: unknown[];
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const request = JSON.parse(await readStdin()) as Request;
if (request.compile.length > 0) throw new Error('compile requests are not supported yet');

process.stdout.write(JSON.stringify({ constants: constants(), cases: request.cases.map(parseCase), compile: [] }));
