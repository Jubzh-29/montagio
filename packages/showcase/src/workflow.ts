import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { compileJob, compileUpscale, type ApiWorkflow, type Aspect, type Library, type Preset } from '@montagio/presets';
import type { ClipEntry, HdPass, Manifest, SampleEntry } from './manifest';

/** The seed of a placeholder's workflow: smoke.ts's default, so a first S3 run reproduces it. */
export const DEFAULT_PLACEHOLDER_SEED = 42;

/** The texts of one clip that override the sample's and the preset's (smoke --prompt, --negative). */
export type ClipTexts = Pick<ClipEntry, 'description' | 'negative'>;

/**
 * The job that renders `preset` on `sample` with the manifest's model, as the
 * S3 session compiles it: smoke.ts names the start image by its file name, and
 * `--prompt` gives the photo's text before the preset's, as the Studio does
 * (without it the camera move is a ghost, docs/S2_RESULTATS.md part 3). A clip
 * rendered from its own description of the photo, or with its own negative
 * (`texts`), compiles with them, as smoke.ts did.
 */
export function showcaseJob(
  library: Pick<Library, 'models' | 'templates'>,
  manifest: Pick<Manifest, 'model'>,
  preset: Preset,
  sample: Pick<SampleEntry, 'file' | 'aspect' | 'prompt'>,
  seed: number,
  texts: ClipTexts = {},
): ReturnType<typeof compileJob> {
  const model = library.models.get(manifest.model);
  if (!model) throw new Error(`the showcase model "${manifest.model}" is not in the registry`);
  const template = library.templates.get(model.workflow);
  if (!template) throw new Error(`the workflow of ${model.id} (${model.workflow}) is not loaded`);
  const description = texts.description ?? sample.prompt;
  const job = compileJob(preset, model, template, {
    imageRef: posix.basename(sample.file),
    seed,
    aspect: sample.aspect,
    ...(description ? { userPrompt: description } : {}),
  });
  if (texts.negative !== undefined) {
    const binding = model.bindings.negative;
    if (!binding) throw new Error(`model ${model.id} has no negative prompt`);
    job.workflow[binding.node]!.inputs[binding.field] = texts.negative;
    job.params.negative = texts.negative;
  }
  return job;
}

/**
 * The workflow of a clip's 1080p pass, as smoke.ts --extension upscale compiled it: the
 * 480p clip under the name the run loaded it, the sample's aspect and the pass's seed.
 */
export function hdWorkflow(library: Pick<Library, 'extensionModels' | 'extensionTemplates'>, hd: Pick<HdPass, 'model' | 'input' | 'seed'>, aspect: Aspect): ApiWorkflow {
  const model = library.extensionModels.get(hd.model);
  if (!model || model.task !== 'v2v-upscale') throw new Error(`"${hd.model}" is not a clip upscaler of the registry`);
  const template = library.extensionTemplates.get(model.workflow);
  if (!template) throw new Error(`the workflow of ${model.id} (${model.workflow}) is not loaded`);
  return compileUpscale(model, template, { videoRef: hd.input, aspect, seed: hd.seed }).workflow;
}

/** The workflow of that job: "Open in ComfyUI" hands it out, and its hash ties a rendered clip to it. */
export function showcaseWorkflow(...args: Parameters<typeof showcaseJob>): ApiWorkflow {
  return showcaseJob(...args).workflow;
}

/** The same value with every object's keys sorted, so equal workflows serialize the same way. */
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

/** sha256 of the canonical JSON of a workflow (sorted keys, no whitespace). */
export function workflowSha256(workflow: ApiWorkflow): string {
  return createHash('sha256').update(JSON.stringify(canonical(workflow))).digest('hex');
}
