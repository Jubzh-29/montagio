import { buildRecipe, sha256Hex, type ApiWorkflow, type Recipe, type RecipeStack } from '@montagio/recipe';
import { compileImage, type Library } from '@montagio/presets';
import { facePrompt, type BankFace } from '@/lib/character-bank';
import { T2I_MODEL } from './tasks/t2i';

/** A starting face is a portrait of the Characters tab: 9:16, at the Studio's 720p. */
export const FACE_ASPECT = '9:16';

/** The workflow the Studio compiles for a face: its text and its seed on the text-to-image model, as /api/images does. */
export function faceWorkflow(lib: Library, face: BankFace): ApiWorkflow {
  const model = lib.models.get(T2I_MODEL);
  const template = model ? lib.templates.get(model.workflow) : undefined;
  if (!model || !template) throw new Error(`the core model ${T2I_MODEL} or its workflow is missing`);
  return compileImage(model, template, { prompt: facePrompt(face), style: {}, seed: face.seed, aspect: FACE_ASPECT }).workflow as ApiWorkflow;
}

/**
 * The recipe of a face, as the history writes one for a photo made here: the /api/images request that
 * renders it again (its text, 9:16, its seed), its workflow, the weights it loads and the stack.
 * `output` is the shipped JPEG's sha256; "face-jpeg" says it was encoded from the PNG after ComfyUI.
 */
export function faceRecipe(lib: Library, face: BankFace, stack: RecipeStack, renderedAt: string, jpeg: Uint8Array): Recipe {
  const prompt = facePrompt(face);
  const recipe = buildRecipe(
    {
      kind: 'photo',
      task: 't2i',
      name: face.name,
      createdAt: renderedAt,
      backend: 'local',
      seed: face.seed,
      // The history's reprise of a photo made from a text, without the photo of the machine.
      reprise: { tab: 'camera', prompt },
      request: { route: '/api/images', body: { prompt, aspect: FACE_ASPECT, seed: face.seed }, files: [] },
      steps: [{ name: 't2i', workflow: faceWorkflow(lib, face), inputs: [] }],
      modelIds: [T2I_MODEL],
      post: ['face-jpeg'],
    },
    { lock: lib.lock.values(), models: [...lib.models.values(), ...lib.extensionModels.values()], stack },
  );
  return { ...recipe, output: { sha256: sha256Hex(jpeg) } };
}
