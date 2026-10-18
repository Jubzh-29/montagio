import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ApiWorkflow, CompiledParams } from '@montagio/presets';

/** The camera move of a compiled job in words: "Zoom In", "Pan Up + Zoom In", "Zoom In, then Static"; null in prompt mode. */
export function cameraMove(params: Pick<CompiledParams, 'cameraPose' | 'cameraPose2' | 'cameraCombine'>): string | null {
  if (!params.cameraPose) return null;
  if (!params.cameraPose2) return params.cameraPose;
  return `${params.cameraPose}${params.cameraCombine === 'then' ? ', then ' : ' + '}${params.cameraPose2}`;
}

// The SDK target guards live in the adapter, which the app's local backend uses too.
export { assertLocalBaseUrl, guardFetch } from '@montagio/comfy-adapter';

type InputSpecs = Record<string, unknown>;
export type ObjectInfo = Record<
  string,
  {
    input?: { required?: InputSpecs; optional?: InputSpecs; hidden?: InputSpecs };
    output?: string[];
    output_name?: string[];
    python_module?: string;
  }
>;

/** The type of an input as /object_info describes it: a combo (legacy option list) counts as COMBO. */
function inputType(spec: unknown): string | null {
  if (!Array.isArray(spec)) return null;
  const type = spec[0] as unknown;
  if (Array.isArray(type)) return 'COMBO';
  return typeof type === 'string' ? type : null;
}

/** ComfyUI's rule: "*" matches anything, and a type may list several, comma-separated. */
function typesMatch(expected: string, received: string): boolean {
  if (expected === '*' || received === '*') return true;
  const received_ = new Set(received.split(','));
  return expected.split(',').some((type) => received_.has(type));
}

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

/** A V3 io.DynamicCombo: each option has a key and inputs of its own, written "<input>.<nested>" in a workflow. */
const DYNAMIC_COMBO = 'COMFY_DYNAMICCOMBO_V3';
type DynamicOption = { key: string | number; inputs?: { required?: InputSpecs; optional?: InputSpecs } };

function dynamicOptions(spec: unknown): DynamicOption[] | null {
  if (!Array.isArray(spec) || spec[0] !== DYNAMIC_COMBO) return null;
  const options = (spec[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(options) ? (options as DynamicOption[]) : null;
}

/** Options of a combo input (a dynamic combo included) as /object_info describes it, or null for any other input. */
export function comboOptions(spec: unknown): (string | number)[] | null {
  if (!Array.isArray(spec)) return null;
  const [type, config] = spec as [unknown, unknown];
  if (Array.isArray(type)) return type as (string | number)[];
  const dynamic = dynamicOptions(spec);
  if (dynamic) return dynamic.map((option) => option.key);
  if (type === 'COMBO' && config && typeof config === 'object' && Array.isArray((config as { options?: unknown }).options)) {
    return (config as { options: (string | number)[] }).options;
  }
  return null;
}

/**
 * The spec of an input, "format.codec" included: the part after a dot is an
 * input of the option the dynamic combo before it has selected in this node.
 * undefined: no such input; null: the dynamic combo holds no valid option, which
 * its own check reports.
 */
function specFor(declared: InputSpecs, inputs: Record<string, unknown>, field: string): unknown {
  const parts = field.split('.');
  let specs: InputSpecs = declared;
  for (let i = 0; i < parts.length - 1; i++) {
    const options = dynamicOptions(specs[parts[i]!]);
    if (!options) return undefined;
    const selected = options.find((option) => option.key === inputs[parts.slice(0, i + 1).join('.')]);
    if (!selected) return null;
    specs = { ...selected.inputs?.optional, ...selected.inputs?.required };
  }
  return specs[parts.at(-1)!];
}

/**
 * Compare a workflow with what the running ComfyUI accepts: installed node
 * classes, input names (unknown ones, missing required ones), links (to an
 * existing node, an existing output, of the expected type) and combo values
 * (camera poses, weight files present on disk).
 * `skip` lists "node.field" inputs that are filled at submit time (uploaded
 * image): their combo value is not checked, their presence still is.
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
    const required = spec.input?.required ?? {};
    const declared = { ...spec.input?.optional, ...required };
    for (const field of Object.keys(required)) {
      if (!(field in node.inputs)) problems.push(`node ${id} (${node.class_type}): missing required input "${field}"`);
    }
    for (const [field, value] of Object.entries(node.inputs)) {
      const fieldSpec = specFor(declared, node.inputs, field);
      if (fieldSpec === null) continue;
      if (fieldSpec === undefined) {
        problems.push(`node ${id} (${node.class_type}): unknown input "${field}"`);
        continue;
      }
      if (isLink(value)) {
        const [from, index] = value;
        const source = workflow[from];
        const outputs = source ? info[source.class_type]?.output : undefined;
        if (!source) {
          problems.push(`node ${id} (${node.class_type}).${field} links to missing node "${from}"`);
        } else if (outputs && index >= outputs.length) {
          problems.push(`node ${id} (${node.class_type}).${field} links to output ${index} of node ${from} (${source.class_type}), which has ${outputs.length} output(s)`);
        } else if (outputs) {
          const expected = inputType(fieldSpec);
          if (expected && !typesMatch(expected, outputs[index]!)) {
            problems.push(`node ${id} (${node.class_type}).${field} expects ${expected}, output ${index} of node ${from} is ${outputs[index]}`);
          }
        }
        continue;
      }
      if (Array.isArray(value) || skip.has(`${id}.${field}`)) continue;
      const options = comboOptions(fieldSpec);
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
