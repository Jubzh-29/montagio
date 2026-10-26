/**
 * install-state.json: the mode, ports and GPU chosen at install, and one stamp
 * per finished step. A stamp is written right after its step succeeds, so a
 * run cut short redoes exactly the steps that had not finished.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PORTS, type Mode, type Ports, type VramProfile } from './checks.ts';
import type { LockWeight } from './pins.ts';

export type WeightRecord = { sha256: string; size: number; mtimeMs: number };
export type StampId = 'comfyui' | 'comfyEnv' | 'proxy' | 'npm' | 'build' | 'ytDlp' | 'voiceNode' | 'segmentNode';

export type InstallState = {
  schema: 'montagio/install@0.1';
  mode: Mode | null;
  ports: Ports;
  gpuIndex: number | null;
  /** App alone with a remote GPU: the comfy-api-proxy URL the app talks to. */
  proxyUrl: string | null;
  /**
   * Full install: the extensions whose weights it fetched (the avatar and the object swap only once their
   * custom node pack is installed), passed to the app as MONTAGIO_EXTENSIONS; null before an install
   * recorded them, or for the app alone, which keeps the user's variable.
   */
  extensions: string[] | null;
  /**
   * What --extensions (or MONTAGIO_EXTENSIONS) asked for, as given ("all", "music,edit"), kept for the next runs
   * until another value or "default"; null for the default.
   */
  extensionsAsked: string | null;
  /** Full install: its memory profile, passed to the app as MONTAGIO_VRAM_PROFILE; null before one, or for the app alone. */
  vramProfile: VramProfile | null;
  /**
   * Full install: the token comfy-api-proxy is started with (--token) and the app sends (MONTAGIO_PROXY_TOKEN), so
   * a page rebound to 127.0.0.1 cannot drive the proxy. Kept here, in the install folder, never in the repository.
   */
  proxyToken: string | null;
  stamps: Partial<Record<StampId, string>>;
  /** Weights hashed once: same size and mtime later means the same bytes, without hashing 70 GB again. */
  weights: Record<string, WeightRecord>;
};

const SCHEMA = 'montagio/install@0.1';

export function emptyState(): InstallState {
  return { schema: SCHEMA, mode: null, ports: { ...DEFAULT_PORTS }, gpuIndex: null, proxyUrl: null, extensions: null, extensionsAsked: null, vramProfile: null, proxyToken: null, stamps: {}, weights: {} };
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

/** A full install with its proxy token: a new random one when it has none yet (an install made before the token). */
export function withProxyToken(state: InstallState): InstallState {
  if (state.mode !== 'full' || state.proxyToken) return state;
  return { ...state, proxyToken: randomBytes(32).toString('hex') };
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
