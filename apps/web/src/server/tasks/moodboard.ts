import { randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { compileEdit, compileImage, parseImageStyle, type Aspect, type ImageStyle, type Library } from '@montagio/presets';
import { moodboardSheet } from '@montagio/sequence';
import { MOODBOARD_INSTRUCTION, MOODBOARD_REFS_MAX } from '@/lib/image-style';
import { JobError } from '../errors';
import { requireExtension } from '../extensions';
import { assertConsent, assertNoBlockedName } from '../guards';
import { jobDir, type TaskDef } from '../jobs';
import { readUploadMeta, type UploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';
import { T2I_MODEL } from './t2i';

/** What the picture shows: shorter than a plain text to image, the moodboard's instruction comes on top. */
export const MOODBOARD_TEXT_MAX = 300;
const ASPECTS: readonly Aspect[] = ['16:9', '9:16', '1:1'];

function editModelOf(lib: Library) {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
  const template = model && lib.extensionTemplates.get(model.workflow);
  if (!model || !template) throw new Error('no edit model or workflow for a moodboard');
  return { model, template };
}

/** The references, each a known upload: one to four, in the order the visitor added them. */
async function referencesOf(raw: unknown): Promise<UploadMeta[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MOODBOARD_REFS_MAX) throw new JobError('invalid-input');
  const metas: UploadMeta[] = [];
  for (const ref of raw) {
    const meta = typeof ref === 'string' ? await readUploadMeta(ref) : null;
    if (!meta) throw new JobError('unknown-image');
    metas.push(meta);
  }
  return metas;
}

/**
 * A moodboard picture: Z-Image-Turbo makes what the text describes, in the chosen format and
 * cinematography, then the edit (Qwen-Image-Edit-2511) gives it the look of a sheet of one to four
 * reference pictures: their palette, light, texture and mood, never their content.
 */
export const moodboardTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('edit');
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const aspect = ASPECTS.find((value) => value === body.aspect);
    const style = parseImageStyle(body.style);
    if (!prompt || prompt.length > MOODBOARD_TEXT_MAX || !aspect || !style) throw new JobError('invalid-input');
    const refs = await referencesOf(body.refs);
    // A reference someone imported asks for consent, as the photos of a composition do.
    for (const meta of refs) assertConsent(meta, body.consent);
    await assertNoBlockedName(prompt);
    const t2i = lib.models.get(T2I_MODEL);
    if (!t2i) throw new Error(`the core model ${T2I_MODEL} is missing from registry/models`);
    const { model } = editModelOf(lib);
    return {
      inputs: {
        prompt,
        ...(Object.keys(style).length > 0 ? { style } : {}),
        refs: refs.map((meta) => meta.imageRef),
        personal: refs.some((meta) => meta.personal),
        // Made from a text: a picture of no one only when every reference is one too.
        ...(refs.every((meta) => meta.fictional === true) ? { fictional: true } : {}),
      },
      label: { name: `${t2i.name} + ${model.name}` },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 't2i',
      presetId: 'text-to-image',
      extension: null,
      compile: async () => {
        const model = lib.models.get(T2I_MODEL)!;
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
    {
      name: 'moodboard',
      presetId: 'moodboard',
      extension: 'edit',
      compile: async (current) => {
        const made = current.steps[0]?.outputPath;
        if (!made) throw new Error('the picture to restyle is missing');
        // The sheet of references, kept with the job: the edit reads it as one style reference.
        const dir = jobDir(record.id);
        await mkdir(dir, { recursive: true });
        const sheet = join(dir, 'moodboard.png');
        await moodboardSheet((record.inputs.refs as string[]).map(uploadPath), sheet);
        const { model, template } = editModelOf(lib);
        const { workflow, output } = compileEdit(
          model,
          template,
          { imageRef: basename(made), image2Ref: basename(sheet), instruction: MOODBOARD_INSTRUCTION, seed: record.seed, fast: true },
          lib.lock,
        );
        return { workflow, output, files: [extensionFile(model, 'image', made), extensionFile(model, 'image2', sheet)] };
      },
    },
  ],

  imageOrigin: async (record) => ({ origin: 'edit', personal: record.inputs.personal === true, ...(record.inputs.fictional === true ? { fictional: true } : {}) }),
};
