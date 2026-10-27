import { randomInt } from 'node:crypto';
import { access } from 'node:fs/promises';
import { basename } from 'node:path';
import { compileEdit, compileRestyle, restyleInstruction, type ComposeRole, type RestyleInputs } from '@montagio/presets';
import { extractFirstFrame } from '@montagio/sequence';
import { JobError } from '../errors';
import { requireExtension, restyleModel, visibleExtensions } from '../extensions';
import { assertAllowedText } from '../guards';
import type { StepPlan, TaskDef } from '../jobs';
import { readUploadMeta, readVideoMeta } from '../uploads';
import { composeOf, composeStep } from './compose';
import { extensionFile, uploadPath, videoPath } from './files';

const TEXT_MAX = 500;

/** A restyle's look may be composed first: a character, its outfit, a product in hand. */
export const RESTYLE_COMPOSE_ROLES: readonly ComposeRole[] = ['character', 'outfit', 'product'];

/** The clip's first frame, written once next to the clip: the photo the restyle's edit changes. */
async function firstFrameOf(videoFile: string): Promise<string> {
  const frame = videoFile.replace(/\.mp4$/, '-first.png');
  await access(frame).catch(() => extractFirstFrame(videoFile, frame));
  return frame;
}

/**
 * A restyle (Wan 2.1 VACE 14B): the scene of the clip rebuilt from the text, its motion, camera move
 * and timing kept. With a look image, VACE follows it. Without one, the edit (when it is shown here)
 * first restyles the clip's first frame from the same text, and the restyle keeps that frame; the
 * text alone drives it otherwise. The look may also be composed first by the edit from a character,
 * its outfit and a product. The user's word that they hold the rights on the clip and the images is
 * required (it stands for the rights box of the Motion tab).
 */
export const restyleTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('restyle');
    const videoRef = typeof body.videoRef === 'string' ? body.videoRef : '';
    const video = await readVideoMeta(videoRef);
    if (!video) throw new JobError('invalid-input');
    const compose = await composeOf(body.compose, RESTYLE_COMPOSE_ROLES, 'character');
    if (compose) await requireExtension('edit');
    const imageRef = compose ? '' : typeof body.imageRef === 'string' ? body.imageRef : '';
    const look = imageRef ? await readUploadMeta(imageRef) : null;
    if (imageRef && !look) throw new JobError('unknown-image');
    if (body.rights !== true) throw new JobError('rights-required');
    const model = restyleModel(lib);
    const max = model.limits.max_chars ?? TEXT_MAX;
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > max) throw new JobError('invalid-input');
    await assertAllowedText(prompt);
    const firstFrame = !look && !compose && (await visibleExtensions()).includes('edit');
    const personal = (compose?.metas ?? (look ? [look] : [])).some((meta) => meta.personal);
    return {
      inputs: { videoRef, video_s: video.duration_s, prompt, ...(look ? { imageRef } : {}), ...(compose ? { compose: compose.refs } : {}), firstFrame, personal },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: video.aspect,
    };
  },

  steps: (record, lib) => {
    const restyle: StepPlan = {
      name: 'restyle',
      presetId: 'restyle',
      extension: 'restyle',
      compile: async (current) => {
        const model = lib.extensionModels.get(current.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const videoFile = videoPath(String(current.inputs.videoRef));
        const imageRef = typeof current.inputs.imageRef === 'string' ? current.inputs.imageRef : undefined;
        // The first step's output: the restyled first frame, or the composed look.
        const made = current.inputs.firstFrame === true || current.inputs.compose ? current.steps[0]?.outputPath : undefined;
        if ((current.inputs.firstFrame === true || current.inputs.compose) && !made) throw new Error('the restyle has no image from its first step');
        const look = current.inputs.compose ? made : imageRef ? uploadPath(imageRef) : undefined;
        const reference = current.inputs.firstFrame === true ? { path: made!, mode: 'first-frame' as const } : look ? { path: look, mode: 'look' as const } : null;
        const inputs: RestyleInputs = {
          videoRef: basename(videoFile),
          video_s: Number(current.inputs.video_s),
          aspect: current.aspect ?? '16:9',
          seed: current.seed,
          prompt: String(current.inputs.prompt),
          ...(reference ? { reference: { imageRef: basename(reference.path), mode: reference.mode } } : {}),
        };
        const { workflow, output } = compileRestyle(model, template, inputs);
        const files = [extensionFile(model, 'video', videoFile)];
        if (reference) files.push(extensionFile(model, 'image', reference.path));
        return { workflow, output, files };
      },
    };
    if (record.inputs.compose) return [composeStep(record, lib), restyle];
    if (record.inputs.firstFrame !== true) return [restyle];
    return [
      {
        name: 'first-frame',
        presetId: 'restyle',
        extension: 'edit',
        compile: async (current) => {
          const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
          const template = model && lib.extensionTemplates.get(model.workflow);
          if (!model || !template) throw new Error('restyle: no edit model or workflow for the first frame');
          const frame = await firstFrameOf(videoPath(String(current.inputs.videoRef)));
          const instruction = restyleInstruction(String(current.inputs.prompt));
          const { workflow, output } = compileEdit(model, template, { imageRef: basename(frame), instruction, seed: current.seed, fast: true }, lib.lock);
          return { workflow, output, files: [extensionFile(model, 'image', frame)] };
        },
      },
      restyle,
    ];
  },
};
