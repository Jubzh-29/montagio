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
/** The type of an output: a type name or, for some legacy nodes, the option list of a combo. */
type OutputType = string | (string | number)[];
export type ObjectInfo = Record<
  string,
  {
    input?: { required?: InputSpecs; optional?: InputSpecs; hidden?: InputSpecs };
    output?: OutputType[];
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

/** A V3 io.MatchType (ResizeImageMaskNode takes IMAGE or MASK and gives back the type it got). */
const MATCH_TYPE = 'COMFY_MATCHTYPE_V3';

/**
 * ComfyUI's rule (comfy_execution/validation.py): "*" matches anything, so does a
 * MatchType on either side (the frontend checks those), a type may list several,
 * comma-separated, and an output typed as an option list goes into a combo.
 */
function typesMatch(expected: string, received: OutputType): boolean {
  if (expected === '*' || expected === MATCH_TYPE) return true;
  if (Array.isArray(received)) return expected === 'COMBO';
  if (received === '*' || received === MATCH_TYPE) return true;
  const received_ = new Set(received.split(','));
  return expected.split(',').some((type) => received_.has(type));
}

function typeLabel(type: OutputType): string {
  return Array.isArray(type) ? `a list of ${type.length} options` : type;
}

/** min and max of an INT or FLOAT input, when /object_info gives them. */
function bounds(spec: unknown): { min?: number; max?: number } {
  const config = Array.isArray(spec) ? (spec[1] as { min?: unknown; max?: unknown } | undefined) : undefined;
  return {
    min: typeof config?.min === 'number' ? config.min : undefined,
    max: typeof config?.max === 'number' ? config.max : undefined,
  };
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
  // an input an Autogrow grew is declared whole: "values.a"
  if (Object.hasOwn(declared, field)) return declared[field];
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
 * The required inputs of the options the dynamic combos of a node have selected,
 * "format.codec.encoding.crf" for instance. As in ComfyUI, a nested dynamic combo
 * counts only when the workflow gives it: get_finalized_class_inputs leaves an
 * absent one out of the schema, so it is never reported missing.
 */
function requiredUnderOptions(declared: InputSpecs, inputs: Record<string, unknown>, prefix = ''): string[] {
  const required: string[] = [];
  for (const [name, spec] of Object.entries(declared)) {
    const path = prefix + name;
    const selected = path in inputs ? dynamicOptions(spec)?.find((option) => option.key === inputs[path]) : undefined;
    if (!selected) continue;
    for (const [nested, nestedSpec] of Object.entries(selected.inputs?.required ?? {})) {
      if (!dynamicOptions(nestedSpec)) required.push(`${path}.${nested}`);
    }
    required.push(...requiredUnderOptions({ ...selected.inputs?.optional, ...selected.inputs?.required }, inputs, `${path}.`));
  }
  return required;
}

/** A V3 io.Autogrow (the values of ComfyMathExpression): inputs written "<input>.<name>", each of its template's type. */
const AUTOGROW = 'COMFY_AUTOGROW_V3';
type AutogrowTemplate = { input: { required?: InputSpecs; optional?: InputSpecs }; names?: string[]; prefix?: string; min: number; max?: number };

/**
 * The inputs of a node with each Autogrow replaced by the inputs it grows, as ComfyUI expands
 * it (_expand_schema_for_dynamic): "values.a", "values.b"…, the first `min` of them required
 * when the template's input is, the others optional; the Autogrow itself is never an input.
 */
function expandAutogrow(input: { required?: InputSpecs; optional?: InputSpecs } | undefined): { required: InputSpecs; optional: InputSpecs } {
  const required: InputSpecs = {};
  const optional: InputSpecs = {};
  for (const [group, specs] of [[required, input?.required], [optional, input?.optional]] as const) {
    for (const [name, spec] of Object.entries(specs ?? {})) {
      const template = Array.isArray(spec) && spec[0] === AUTOGROW ? (spec[1] as { template: AutogrowTemplate }).template : null;
      if (!template) {
        group[name] = spec;
        continue;
      }
      const requiredItem = Object.values(template.input.required ?? {})[0];
      const item = requiredItem ?? Object.values(template.input.optional ?? {})[0];
      const names = template.names ?? Array.from({ length: template.max ?? 0 }, (_, i) => `${template.prefix}${i}`);
      names.forEach((grown, i) => {
        (i < template.min && requiredItem !== undefined ? required : optional)[`${name}.${grown}`] = item;
      });
    }
  }
  return { required, optional };
}

/**
 * Compare a workflow with what the running ComfyUI accepts: installed node
 * classes, input names (unknown ones, missing required ones, those of the
 * option a dynamic combo selected included), links (to an existing node, an
 * existing output, of the expected type), min and max bounds, and combo values
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
    const { required, optional } = expandAutogrow(spec.input);
    const declared = { ...optional, ...required };
    for (const field of [...Object.keys(required), ...requiredUnderOptions(declared, node.inputs)]) {
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
            problems.push(`node ${id} (${node.class_type}).${field} expects ${expected}, output ${index} of node ${from} is ${typeLabel(outputs[index]!)}`);
          }
        }
        continue;
      }
      if (Array.isArray(value) || skip.has(`${id}.${field}`)) continue;
      const { min, max } = bounds(fieldSpec);
      if (typeof value === 'number' && min !== undefined && value < min) {
        problems.push(`node ${id} (${node.class_type}).${field} = ${value} is below the min of ${min}`);
        continue;
      }
      if (typeof value === 'number' && max !== undefined && value > max) {
        problems.push(`node ${id} (${node.class_type}).${field} = ${value} is above the max of ${max}`);
        continue;
      }
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
