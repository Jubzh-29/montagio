import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileAvatar, compileSpeech } from '@montagio/presets';
import { probeAudio } from '@montagio/sequence';
import { JobError } from '../errors';
import { avatarModels, requireExtension } from '../extensions';
import { assertConsent, assertNoBlockedName } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

const TEXT_MAX = 300;
const LANGUAGES = ['en', 'fr'] as const;

/**
 * A photo that speaks: the built-in voice says the text (Chatterbox, no cloning), then
 * Wan 2.2 S2V animates the photo for the length of that voice. The length is known only
 * once the voice exists: past the model's 15 s, the job ends in speech-too-long.
 */
export const avatarTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('avatar');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = await readUploadMeta(imageRef);
    if (!photo) throw new JobError('unknown-image');
    const { voice, avatar } = avatarModels(lib);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > (voice.limits.max_chars ?? TEXT_MAX)) throw new JobError('invalid-input');
    const language = LANGUAGES.find((entry) => entry === body.language);
    if (!language) throw new JobError('invalid-input');
    assertConsent(photo, body.consent);
    await assertNoBlockedName(text);
    return {
      inputs: { imageRef, text, language, personal: photo.personal },
      label: { name: 'Avatar' },
      modelId: avatar.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => {
    const { voice, avatar } = avatarModels(lib);
    return [
      {
        name: 'voice',
        presetId: 'avatar-voice',
        extension: 'avatar',
        compile: async () => {
          const template = lib.extensionTemplates.get(voice.workflow);
          if (!template) throw new Error(`the workflow ${voice.workflow} of ${voice.id} is missing`);
          const language = record.inputs.language === 'fr' ? 'fr' : 'en';
          const { workflow, output } = compileSpeech(voice, template, { text: String(record.inputs.text), language, seed: record.seed });
          return { workflow, output, files: [] };
        },
      },
      {
        name: 'avatar',
        presetId: 'avatar',
        extension: 'avatar',
        compile: async (current) => {
          const template = lib.extensionTemplates.get(avatar.workflow);
          const speech = current.steps[0]?.outputPath;
          if (!template || !speech) throw new Error(`avatar: no workflow for ${avatar.id}, or no voice`);
          const audio_s = (await probeAudio(speech))?.duration_s ?? 0;
          if (audio_s > (avatar.limits.max_duration_s ?? Infinity)) throw new JobError('speech-too-long');
          const imageRef = String(current.inputs.imageRef);
          const { workflow, output } = compileAvatar(avatar, template, {
            imageRef,
            audioRef: basename(speech),
            audio_s,
            aspect: current.aspect ?? '16:9',
            seed: current.seed,
          });
          return { workflow, output, files: [extensionFile(avatar, 'image', uploadPath(imageRef)), extensionFile(avatar, 'audio', speech)] };
        },
      },
    ];
  },
};
