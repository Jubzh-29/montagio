import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { compileTranslate, TRANSLATE_LANGUAGES, type Library } from '@montagio/presets';
import type { ExtensionModel } from '@montagio/registry';
import { extractFirstFrame } from '@montagio/sequence';
import { getEnv } from '../env';
import { JobError } from '../errors';
import { avatarModels, requireExtension } from '../extensions';
import { assertConsent } from '../guards';
import { jobs, type TaskDef } from '../jobs';
import { readSpeechMeta, readUploadMeta, saveUploadFromFile } from '../uploads';
import { talkingStep } from './avatar';
import { extensionFile, speechPath } from './files';

export function translateModel(lib: Library): ExtensionModel | undefined {
  return [...lib.extensionModels.values()].find((entry) => entry.task === 'a2a-translate');
}

/** The speech to translate and the face that says it again: an avatar made here, or a video sent here. */
async function sourceOf(body: Record<string, unknown>): Promise<{ speech: Record<string, string>; imageRef: string; personal: boolean; duration_s?: number }> {
  if (typeof body.sourceJobId === 'string') {
    const record = await jobs.read(body.sourceJobId);
    const voice = record?.task === 'avatar' && record.state === 'succeeded' ? record.steps[0]?.outputPath : undefined;
    const photo = record && typeof record.inputs.imageRef === 'string' ? await readUploadMeta(record.inputs.imageRef) : null;
    if (!record || !voice || !photo) throw new JobError('invalid-input');
    return { speech: { jobId: record.id }, imageRef: photo.imageRef, personal: photo.personal };
  }
  const speech = typeof body.speechRef === 'string' ? await readSpeechMeta(body.speechRef) : null;
  if (!speech) throw new JobError('invalid-input');
  // A video someone sent: they hold its rights, and its speaker agreed to their face and voice in another language.
  if (body.rights !== true) throw new JobError('rights-required');
  if (body.consent !== true) throw new JobError('consent-required');
  // Its first frame is the photo the translated clip starts from.
  const dir = join(getEnv().data, 'tmp');
  await mkdir(dir, { recursive: true });
  const frame = join(dir, `${randomUUID()}.png`);
  try {
    await extractFirstFrame(speechPath(speech.speechRef), frame);
    const photo = await saveUploadFromFile(frame, { origin: 'frame', personal: true });
    return { speech: { audioRef: speech.audioRef }, imageRef: photo.imageRef, personal: true, duration_s: speech.duration_s };
  } finally {
    await rm(frame, { force: true });
  }
}

/** The speech file of a source: the voice step of an avatar made here, or the sound of a video sent here. */
async function speechFileOf(speech: Record<string, string>): Promise<string> {
  if (speech.jobId) {
    const voice = (await jobs.read(speech.jobId))?.steps[0]?.outputPath;
    if (!voice) throw new Error('the speech of the avatar to translate is gone');
    return voice;
  }
  return speechPath(String(speech.audioRef));
}

/**
 * Translate: the speech of a clip said again in another language, in the same voice, and the face
 * animated again on it so that the lips follow the new words. Gemma 4 E4B hears the speech and
 * writes the translation, Chatterbox says it, Wan 2.2 S2V makes the talking clip; the result
 * carries the AI mention like every clip.
 */
export const translateTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('avatar');
    const model = translateModel(lib);
    if (!model) throw new JobError('extension-disabled');
    const language = TRANSLATE_LANGUAGES.find((value) => value === body.language);
    if (!language) throw new JobError('invalid-input');
    const source = await sourceOf(body);
    if (source.duration_s !== undefined && source.duration_s > (model.limits.max_duration_s ?? Infinity)) throw new JobError('speech-too-long');
    const photo = await readUploadMeta(source.imageRef);
    if (!photo) throw new JobError('unknown-image');
    // A photo of someone made here keeps the consent asked when it was imported.
    if (body.sourceJobId !== undefined) assertConsent(photo, body.consent);
    const { avatar } = avatarModels(lib);
    return {
      inputs: { speech: source.speech, imageRef: source.imageRef, language, personal: source.personal },
      label: { name: `${model.name} + ${avatar.name}` },
      modelId: avatar.id,
      seed: randomInt(0, 2 ** 32),
      aspect: photo.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'translate',
      presetId: 'translate',
      extension: 'avatar',
      compile: async () => {
        const model = translateModel(lib);
        const template = model && lib.extensionTemplates.get(model.workflow);
        if (!model || !template) throw new Error('no translate model or workflow');
        const speech = await speechFileOf(record.inputs.speech as Record<string, string>);
        const language = TRANSLATE_LANGUAGES.find((value) => value === record.inputs.language) ?? 'en';
        const { workflow, output } = compileTranslate(model, template, { audioRef: basename(speech), language, seed: record.seed });
        return { workflow, output, files: [extensionFile(model, 'audio', speech)] };
      },
    },
    talkingStep(lib),
  ],
};
