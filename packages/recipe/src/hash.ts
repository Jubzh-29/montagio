import { createHash } from 'node:crypto';
import type { ApiWorkflow, InputSlot, StepSettings } from './types';

/** The same value with every object's keys sorted, so equal values serialize the same way. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** JSON with sorted keys and no whitespace. */
export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** sha256 of the canonical JSON of a workflow. */
export const workflowSha256 = (workflow: ApiWorkflow): string => sha256Hex(canonicalJson(workflow));

/** A copy of the workflow with each input file named "<from>": two uploads of the same photo hash the same. */
export function normalizeWorkflow(workflow: ApiWorkflow, slots: readonly InputSlot[]): ApiWorkflow {
  const copy = structuredClone(workflow);
  for (const slot of slots) {
    const node = copy[slot.node];
    if (node && slot.field in node.inputs) node.inputs[slot.field] = `<${slot.from}>`;
  }
  return copy;
}

const nodeOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
/** The first value of each of these inputs, in node order. */
const NUMBERS: Record<string, keyof Omit<StepSettings, 'seeds' | 'texts'>> = {
  width: 'width',
  height: 'height',
  length: 'frames',
  num_frames: 'frames',
  fps: 'fps',
  frame_rate: 'fps',
  steps: 'steps',
  cfg: 'cfg',
};
const SEEDS = new Set(['seed', 'noise_seed']);
const TEXTS = new Set(['text', 'prompt', 'positive_prompt', 'tags', 'lyrics']);
/** An input file's marker, put there by normalizeWorkflow: not a text of the render. */
const MARKER = /^<[^<>]+>$/;

export function summarizeWorkflow(workflow: ApiWorkflow): StepSettings {
  const settings: StepSettings = { seeds: [], texts: [] };
  for (const id of Object.keys(workflow).sort(nodeOrder)) {
    for (const [key, value] of Object.entries(workflow[id]!.inputs)) {
      if (typeof value === 'number') {
        const name = NUMBERS[key];
        if (name && settings[name] === undefined) settings[name] = value;
        if (SEEDS.has(key) && !settings.seeds.includes(value)) settings.seeds.push(value);
      } else if (typeof value === 'string' && TEXTS.has(key) && value.trim() && !MARKER.test(value) && !settings.texts.includes(value)) {
        settings.texts.push(value);
      }
    }
  }
  return settings;
}

/** Strings that name a file or folder of the machine: a drive, a share, a home folder, an upload of the app. */
const LOCAL_PATH = [
  /^[A-Za-z]:[\\/]/,
  /^\\\\/,
  /^\/(?:home|Users|root|tmp|var|mnt|media|data|opt|srv|workspace|private)\//,
  /[\\/](?:Users|home)[\\/]/,
  /(?:^|[\\/])uploads[\\/][0-9a-f]{8}-/i,
];

/** The first string inside `value` that looks like a path of the machine, or null. */
export function findLocalPath(value: unknown): string | null {
  if (typeof value === 'string') return LOCAL_PATH.some((pattern) => pattern.test(value)) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLocalPath(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') return findLocalPath(Object.values(value));
  return null;
}
