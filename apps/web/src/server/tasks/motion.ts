import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileMotion, type ComposeRole } from '@montagio/presets';
import { JobError } from '../errors';
import { motionModel, requireExtension } from '../extensions';
import { assertNoBlockedName } from '../guards';
import type { StepPlan, TaskDef } from '../jobs';
import { readUploadMeta, readVideoMeta } from '../uploads';
import { composeOf, composeStep } from './compose';
import { extensionFile, uploadPath, videoPath } from './files';

const TEXT_MAX = 500;

/** A motion's character may be composed first: a character, its outfit, a product in hand. */
export const MOTION_COMPOSE_ROLES: readonly ComposeRole[] = ['character', 'outfit', 'product'];

/**
 * A motion transfer (Wan2.2-Animate-2 distilled): the character of the photo performs the
 * motion of the reference clip, prepared at upload. The character may be composed first by the
 * edit (a character with an outfit and a product, seen full body). The user's word that they hold
 * the rights on the video and the photos is required (it stands for the rights box on this tab).
 */
export const motionTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('motion');
    const compose = await composeOf(body.compose, MOTION_COMPOSE_ROLES, 'character');
    if (compose) await requireExtension('edit');
    // A composition's first reference is its character: the photo of record.
    const imageRef = compose ? compose.metas[0]!.imageRef : typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const videoRef = typeof body.videoRef === 'string' ? body.videoRef : '';
    const video = await readVideoMeta(videoRef);
    if (!video) throw new JobError('invalid-input');
    if (body.rights !== true) throw new JobError('rights-required');
    const model = motionModel(lib);
    const max = model.limits.max_chars ?? TEXT_MAX;
    const character = typeof body.character === 'string' ? body.character.trim() : '';
    const motion = typeof body.motion === 'string' ? body.motion.trim() : '';
    if (character.length > max || motion.length > max) throw new JobError('invalid-input');
    await assertNoBlockedName(`${character} ${motion}`);
    return {
      inputs: {
        imageRef,
        videoRef,
        video_s: video.duration_s,
        character,
        motion,
        personal: (compose?.metas ?? [photo]).some((meta) => meta.personal),
        ...(compose ? { compose: compose.refs } : {}),
      },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: video.aspect,
    };
  },

  steps: (record, lib) => [
    ...(record.inputs.compose ? [composeStep(record, lib, { fullBody: true })] : []),
    {
      name: 'motion',
      presetId: 'motion',
      extension: 'motion',
      compile: async (current) => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        // After a composition the character is the composed photo, the first step's output.
        const composed = current.inputs.compose ? current.steps[0]?.outputPath : undefined;
        if (current.inputs.compose && !composed) throw new Error('the composed character is missing');
        const imageRef = composed ? basename(composed) : String(record.inputs.imageRef);
        const videoFile = videoPath(String(record.inputs.videoRef));
        const character = String(record.inputs.character ?? '');
        const motion = String(record.inputs.motion ?? '');
        const { workflow, output } = compileMotion(model, template, {
          imageRef,
          videoRef: basename(videoFile),
          video_s: Number(record.inputs.video_s),
          aspect: record.aspect ?? '16:9',
          seed: record.seed,
          ...(character ? { character } : {}),
          ...(motion ? { motion } : {}),
        });
        return { workflow, output, files: [extensionFile(model, 'image', composed ?? uploadPath(imageRef)), extensionFile(model, 'video', videoFile)] };
      },
    } satisfies StepPlan,
  ],
};
