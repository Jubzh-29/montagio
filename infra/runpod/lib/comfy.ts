import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ApiWorkflow } from '@montagio/presets';

/** Hosts run by Comfy (Cloud, the Router API, serverless deployments): never a target of the GPU tooling. */
const COMFY_HOSTED = [/(^|\.)comfy\.org$/i, /(^|\.)comfy\.app$/i];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Validate the SDK base URL. `@comfyorg/sdk` reads COMFY_BASE_URL and silently
 * targets Comfy Cloud when it is blank, so the tooling always passes an explicit
 * self-hosted URL and refuses every Comfy-hosted surface.
 */
export function assertLocalBaseUrl(raw: string): { url: URL; base: string; loopback: boolean } {
  const value = raw.trim();
  if (!value) throw new Error('the SDK base URL must be explicit (a blank value means Comfy Cloud to @comfyorg/sdk)');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid SDK base URL ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`SDK base URL must be http(s), got ${url.protocol}`);
  if (url.search || url.hash || /[?#]/.test(value)) throw new Error('SDK base URL must have no query or fragment');
  if (COMFY_HOSTED.some((host) => host.test(url.hostname))) {
    throw new Error(`refused: ${url.hostname} is a Comfy-hosted surface; the GPU tooling only talks to a self-hosted comfy-api-proxy`);
  }
  // The SDK appends API paths to this string, so it must not end with a slash.
  return { url, base: value.replace(/\/+$/, ''), loopback: LOOPBACK.has(url.hostname) };
}

/**
 * A `fetch` for the SDK that refuses every request outside the base URL's
 * origin, so nothing can reach Comfy Cloud or the Router even if the SDK or a
 * server-provided link points elsewhere.
 */
export function guardFetch(base: URL, inner: typeof fetch = fetch): typeof fetch {
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== base.origin) throw new Error(`refused request to ${target.origin}: only ${base.origin} is allowed`);
    const response = await inner(input, init);
    if (response.redirected && new URL(response.url).origin !== base.origin) {
      throw new Error(`refused redirect to ${new URL(response.url).origin}: only ${base.origin} is allowed`);
    }
    return response;
  };
  return guarded as typeof fetch;
}

type InputSpecs = Record<string, unknown>;
export type ObjectInfo = Record<string, { input?: { required?: InputSpecs; optional?: InputSpecs } }>;

/** Options of a combo input as /object_info describes it, or null for any other input. */
export function comboOptions(spec: unknown): (string | number)[] | null {
  if (!Array.isArray(spec)) return null;
  const [type, config] = spec as [unknown, unknown];
  if (Array.isArray(type)) return type as (string | number)[];
  if (type === 'COMBO' && config && typeof config === 'object' && Array.isArray((config as { options?: unknown }).options)) {
    return (config as { options: (string | number)[] }).options;
  }
  return null;
}

/**
 * Compare a workflow with what the running ComfyUI accepts: installed node
 * classes and combo values (camera poses, weight files present on disk).
 * `skip` lists "node.field" inputs that are filled at submit time (uploaded image).
 */
export function checkWorkflow(workflow: ApiWorkflow, info: ObjectInfo, opts: { skip?: string[] } = {}): string[] {
  const skip = new Set(opts.skip ?? []);
  const problems: string[] = [];
  for (const [id, node] of Object.entries(workflow)) {
    const spec = info[node.class_type];
    if (!spec) {
      problems.push(`node ${id}: class ${node.class_type} is not installed`);
      continue;
    }
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) || skip.has(`${id}.${field}`)) continue;
      const options = comboOptions(spec.input?.required?.[field] ?? spec.input?.optional?.[field]);
      if (options && (typeof value === 'string' || typeof value === 'number') && !options.includes(value)) {
        const shown = options.slice(0, 12).join(', ') + (options.length > 12 ? `, … (${options.length} values)` : '');
        problems.push(`node ${id} (${node.class_type}).${field} = ${JSON.stringify(value)} is not one of: ${shown || '(none)'}`);
      }
    }
  }
  return problems;
}

export function parseNvidiaSmiLine(line: string): { usedMiB: number; totalMiB: number } | null {
  const [used, total] = line.split(',').map((part) => Number(part.trim()));
  return Number.isFinite(used) && Number.isFinite(total) ? { usedMiB: used!, totalMiB: total! } : null;
}

export type VramStats = { source: 'nvidia-smi' | 'system_stats' | 'none'; baselineMiB: number | null; peakMiB: number | null; totalMiB: number | null };

/**
 * Samples GPU memory while a job runs: `nvidia-smi` every 500 ms when it exists
 * (whole GPU, every process), otherwise ComfyUI's /system_stats once a second.
 * Mode "comfyui" skips nvidia-smi: needed when the script runs on another
 * machine than the GPU (SSH tunnel), where nvidia-smi would read the wrong card.
 */
export class VramSampler {
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stats: VramStats = { source: 'none', baselineMiB: null, peakMiB: null, totalMiB: null };

  constructor(
    private readonly comfyuiUrl: string | null,
    private readonly mode: 'auto' | 'comfyui' | 'none' = 'auto',
  ) {}

  private record(usedMiB: number, totalMiB: number): void {
    this.stats.baselineMiB ??= usedMiB;
    this.stats.peakMiB = Math.max(this.stats.peakMiB ?? 0, usedMiB);
    this.stats.totalMiB = totalMiB;
  }

  /** Resolves once a first sample (the baseline) is in, or after 5 s. */
  async start(): Promise<VramStats['source']> {
    if (this.mode === 'none') return 'none';
    const started = this.mode === 'comfyui' ? false : await new Promise<boolean>((resolve) => {
      const child = spawn('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits', '-lms', '500'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const giveUp = setTimeout(() => resolve(true), 5000);
      child.once('error', () => {
        clearTimeout(giveUp);
        resolve(false);
      });
      createInterface({ input: child.stdout! }).on('line', (line) => {
        const sample = parseNvidiaSmiLine(line);
        if (!sample) return;
        this.record(sample.usedMiB, sample.totalMiB);
        clearTimeout(giveUp);
        resolve(true);
      });
      this.child = child;
    });
    if (started) return (this.stats.source = 'nvidia-smi');
    this.child = null;
    if (!this.comfyuiUrl) return 'none';
    const poll = async () => {
      try {
        const res = await fetch(new URL('/system_stats', this.comfyuiUrl!));
        const body = (await res.json()) as { devices?: { vram_total?: number; vram_free?: number }[] };
        const device = body.devices?.[0];
        if (device?.vram_total && device.vram_free !== undefined) {
          const MiB = 1024 * 1024;
          this.record((device.vram_total - device.vram_free) / MiB, device.vram_total / MiB);
        }
      } catch {
        // ComfyUI busy or unreachable: keep the samples we have
      }
    };
    await poll();
    this.timer = setInterval(poll, 1000);
    return (this.stats.source = 'system_stats');
  }

  stop(): VramStats {
    this.child?.kill();
    if (this.timer) clearInterval(this.timer);
    return { ...this.stats };
  }
}
