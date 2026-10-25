import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileMotion } from '@montagio/presets';
import { JobError } from '../errors';
import { motionModel, requireExtension } from '../extensions';
import { assertNoBlockedName } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta, readVideoMeta } from '../uploads';
import { extensionFile, uploadPath, videoPath } from './files';

const TEXT_MAX = 500;

/**
 * A motion transfer (Wan2.2-Animate-2 distilled): the character of the photo performs the
 * motion of the reference clip, prepared at upload. The user's word that they hold the rights
 * on the video and the photo is required (it stands for the consent box on this tab), except
 * on the sample dance with a photo nobody imported.
 */
export const motionTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('motion');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const videoRef = typeof body.videoRef === 'string' ? body.videoRef : '';
    const video = await readVideoMeta(videoRef);
    if (!video) throw new JobError('invalid-input');
    // The sample dance on a photo nobody imported: Montagio's own files, no rights to confirm.
    const ownFiles = video.origin === 'sample' && !photo.personal;
    if (body.rights !== true && !ownFiles) throw new JobError('rights-required');
    const model = motionModel(lib);
    const max = model.limits.max_chars ?? TEXT_MAX;
    const character = typeof body.character === 'string' ? body.character.trim() : '';
    const motion = typeof body.motion === 'string' ? body.motion.trim() : '';
    if (character.length > max || motion.length > max) throw new JobError('invalid-input');
    await assertNoBlockedName(`${character} ${motion}`);
    return {
      inputs: { imageRef, videoRef, video_s: video.duration_s, character, motion, personal: photo.personal },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: video.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'motion',
      presetId: 'motion',
      extension: 'motion',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const imageRef = String(record.inputs.imageRef);
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
        return { workflow, output, files: [extensionFile(model, 'image', uploadPath(imageRef)), extensionFile(model, 'video', videoFile)] };
      },
    },
  ],
};
