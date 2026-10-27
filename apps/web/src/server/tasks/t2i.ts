import { randomInt } from 'node:crypto';
import { compileImage, IMAGE_PROMPT_MAX, parseImageStyle, type Aspect, type ImageStyle } from '@montagio/presets';
import { JobError } from '../errors';
import { assertAllowedText } from '../guards';
import type { TaskDef } from '../jobs';
import { replaySeed } from '../inputs';

/** The core text-to-image model (registry/models/z-image-turbo.yaml): not an extension, always on. */
export const T2I_MODEL = 'z-image-turbo';
const ASPECTS: readonly Aspect[] = ['16:9', '9:16', '1:1'];

/** Text to image: the start photo of a shot, from a text, registered as an upload of origin "t2i". */
export const t2iTask: TaskDef = {
  async prepare(body, lib) {
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, IMAGE_PROMPT_MAX) : '';
    const aspect = ASPECTS.find((value) => value === body.aspect);
    // The cinematography chips (camera, lens, film, light, palette): known choices only.
    const style = parseImageStyle(body.style);
    if (!prompt || !aspect || !style) throw new JobError('invalid-input');
    await assertAllowedText(prompt);
    const model = lib.models.get(T2I_MODEL);
    if (!model) throw new Error(`the core model ${T2I_MODEL} is missing from registry/models`);
    const seed = replaySeed(body.seed) ?? randomInt(0, 2 ** 32);
    return { inputs: { prompt, ...(Object.keys(style).length > 0 ? { style } : {}) }, label: { name: model.name }, modelId: model.id, seed, aspect };
  },

  steps: (record, lib) => [
    {
      name: 't2i',
      presetId: 'text-to-image',
      extension: null,
      compile: async () => {
        const model = lib.models.get(record.modelId)!;
        const template = lib.templates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const { workflow, output } = compileImage(model, template, {
          prompt: String(record.inputs.prompt),
          style: (record.inputs.style ?? {}) as ImageStyle,
          seed: record.seed,
          aspect: record.aspect ?? '16:9',
        });
        return { workflow, output, files: [] };
      },
    },
  ],

  imageOrigin: async () => ({ origin: 't2i', personal: false, fictional: true }),
};
