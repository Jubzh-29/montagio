import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { compileJob, type ApiWorkflow, type Library, type Preset } from '@montagio/presets';
import type { Manifest, SampleEntry } from './manifest';

/** The seed of a placeholder's workflow: smoke.ts's default, so a first S3 run reproduces it. */
export const DEFAULT_PLACEHOLDER_SEED = 42;

/**
 * The job that renders `preset` on `sample` with the manifest's model, as the
 * S3 session compiles it: smoke.ts names the start image by its file name, and
 * `--prompt` gives the photo's text before the preset's, as the Studio does
 * (without it the camera move is a ghost, docs/S2_RESULTATS.md part 3).
 */
export function showcaseJob(
  library: Pick<Library, 'models' | 'templates'>,
  manifest: Pick<Manifest, 'model'>,
  preset: Preset,
  sample: Pick<SampleEntry, 'file' | 'aspect' | 'prompt'>,
  seed: number,
): ReturnType<typeof compileJob> {
  const model = library.models.get(manifest.model);
  if (!model) throw new Error(`the showcase model "${manifest.model}" is not in the registry`);
  const template = library.templates.get(model.workflow);
  if (!template) throw new Error(`the workflow of ${model.id} (${model.workflow}) is not loaded`);
  return compileJob(preset, model, template, {
    imageRef: posix.basename(sample.file),
    seed,
    aspect: sample.aspect,
    ...(sample.prompt ? { userPrompt: sample.prompt } : {}),
  });
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
