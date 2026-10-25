/**
 * install-state.json: the mode, ports and GPU chosen at install, and one stamp
 * per finished step. A stamp is written right after its step succeeds, so a
 * run cut short redoes exactly the steps that had not finished.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PORTS, type Mode, type Ports, type VramProfile } from './checks.ts';
import type { LockWeight } from './pins.ts';

export type WeightRecord = { sha256: string; size: number; mtimeMs: number };
export type StampId = 'comfyui' | 'comfyEnv' | 'proxy' | 'npm' | 'build';

export type InstallState = {
  schema: 'montagio/install@0.1';
  mode: Mode | null;
  ports: Ports;
  gpuIndex: number | null;
  /** App alone with a remote GPU: the comfy-api-proxy URL the app talks to. */
  proxyUrl: string | null;
  /**
   * Full install: the extensions whose weights it fetched (never the avatar, whose voice node
   * it does not install), passed to the app as MONTAGIO_EXTENSIONS; null before an install
   * recorded them, or for the app alone, which keeps the user's variable.
   */
  extensions: string[] | null;
  /** Full install: its memory profile, passed to the app as MONTAGIO_VRAM_PROFILE; null before one, or for the app alone. */
  vramProfile: VramProfile | null;
  stamps: Partial<Record<StampId, string>>;
  /** Weights hashed once: same size and mtime later means the same bytes, without hashing 70 GB again. */
  weights: Record<string, WeightRecord>;
};

const SCHEMA = 'montagio/install@0.1';

export function emptyState(): InstallState {
  return { schema: SCHEMA, mode: null, ports: { ...DEFAULT_PORTS }, gpuIndex: null, proxyUrl: null, extensions: null, vramProfile: null, stamps: {}, weights: {} };
}

/** An absent, unreadable or foreign file gives an empty state: every step runs again, which is always safe. */
export function readState(path: string): InstallState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<InstallState>;
    if (parsed.schema !== SCHEMA) return emptyState();
    const empty = emptyState();
    return {
      ...empty,
      ...parsed,
      ports: { ...empty.ports, ...parsed.ports },
      stamps: { ...parsed.stamps },
      weights: { ...parsed.weights },
    };
  } catch {
    return emptyState();
  }
}

/** Written to <path>.tmp then renamed, so a crash never leaves half a file. */
export function writeState(path: string, state: InstallState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** Record the weights fetch-weights verified (weights-report.json) whose sha256 is the lock's. */
export function recordWeights(
  state: InstallState,
  report: { weights: { id: string; status: string; sha256: string | null }[] },
  lock: LockWeight[],
  stat: (id: string) => { size: number; mtimeMs: number } | null,
): InstallState {
  const weights = { ...state.weights };
  for (const outcome of report.weights) {
    const pinned = lock.find((w) => w.id === outcome.id);
    if (!pinned || (outcome.status !== 'downloaded' && outcome.status !== 'present') || outcome.sha256 !== pinned.sha256) continue;
    const file = stat(outcome.id);
    if (file) weights[outcome.id] = { sha256: pinned.sha256, size: file.size, mtimeMs: file.mtimeMs };
  }
  return { ...state, weights };
}
