import { buildRecipe, sha256Hex, type InputSlot, type Recipe, type RecipeRequest, type RecipeStack } from '@montagio/recipe';
import type { Library } from '@montagio/presets';
import type { ClipEntry, Manifest, SampleEntry } from './manifest';
import { hdWorkflow, showcaseWorkflow, workflowSha256 } from './workflow';

/** The node and input a model binds a file to (its first target). */
function slot(binding: { node: string; field: string } | readonly { node: string; field: string }[] | undefined, from: string, sha256: string): InputSlot {
  const target = Array.isArray(binding) ? binding[0] : binding;
  if (!target) throw new Error(`no binding for the ${from} input`);
  return { node: target.node, field: target.field, from, sha256 };
}

/**
 * The recipe of a rendered clip of the showcase, from its manifest entry: the photo by its sha256, the
 * 480p render's workflow, then its HD pass's, each compiled again and checked against the sha256 the
 * manifest noted (a mismatch throws: the recipe would not be the one that rendered it). Its request
 * renders it again on a Montagio at home, the description, the negative and the seed included.
 */
export function showcaseRecipe(
  library: Library,
  manifest: Pick<Manifest, 'model'>,
  entry: ClipEntry,
  sample: SampleEntry,
  presetYaml: string,
  stack: RecipeStack,
): Recipe {
  const preset = library.presets.get(entry.preset);
  const model = library.models.get(manifest.model);
  if (!preset || !model) throw new Error(`${entry.preset} on ${entry.sample}: the preset or the model is not in the library`);
  const label = `${entry.preset} on ${entry.sample}`;
  const camera = showcaseWorkflow(library, manifest, preset, sample, entry.seed, entry);
  if (workflowSha256(camera) !== entry.workflow_sha256) throw new Error(`${label}: its workflow is not the one of the manifest's workflow_sha256`);
  const steps = [{ name: 'camera', workflow: camera, inputs: [slot(model.bindings.image, 'imageRef', entry.image_sha256)] }];
  let then: RecipeRequest[] | undefined;
  if (entry.hd) {
    const upscaler = library.extensionModels.get(entry.hd.model);
    const hd = hdWorkflow(library, entry.hd, sample.aspect);
    if (workflowSha256(hd) !== entry.hd.workflow_sha256) throw new Error(`${label}: its HD pass is not the one of the manifest's workflow_sha256`);
    steps.push({ name: 'upscale', workflow: hd, inputs: [slot(upscaler?.bindings.video, 'step:0', entry.hd.source_sha256)] });
    // The showcase's HD pass kept the clip's frame rate (no RIFE).
    then = [{ route: '/api/generations/:parent/upscale', body: { smooth: false, seed: entry.hd.seed }, files: [] }];
  }
  const description = entry.description ?? sample.prompt;
  return buildRecipe(
    {
      kind: 'clip',
      task: 'camera',
      name: preset.name,
      createdAt: entry.rendered_at,
      backend: 'local',
      seed: entry.seed,
      preset: { id: preset.id, remix: false, sha256: sha256Hex(presetYaml) },
      presetYaml,
      reprise: { tab: 'camera', presetId: preset.id, modelId: model.id, ...(description ? { prompt: description } : {}), seed: entry.seed },
      request: {
        route: '/api/generations',
        body: {
          presetId: preset.id,
          modelId: model.id,
          ...(description ? { userPrompt: description } : {}),
          ...(entry.negative ? { negative: entry.negative } : {}),
          seed: entry.seed,
        },
        files: [{ field: 'imageRef', sha256: entry.image_sha256 }],
        ...(then ? { then } : {}),
      },
      steps,
      modelIds: [model.id, ...(entry.hd ? [entry.hd.model] : [])],
      // The showcase gives every clip one shared encoding (SHOWCASE_X264) after ComfyUI.
      post: ['showcase-encode'],
    },
    { lock: library.lock.values(), models: [...library.models.values(), ...library.extensionModels.values()], stack },
  );
}
