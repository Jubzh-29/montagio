import { basename, join } from 'node:path';
import { compileVoiceChange, type Library } from '@montagio/presets';
import type { ExtensionModel } from '@montagio/registry';
import { replaceAudio } from '@montagio/sequence';
import { JobError } from '../errors';
import { requireExtension } from '../extensions';
import { mediaFileFor, mediaUrlFor } from '../generations';
import { jobs, type TaskDef } from '../jobs';
import { readSpeechMeta, readVoiceMeta, saveSpeechFromFile, type SpeechMeta } from '../uploads';
import { extensionFile, speechPath, voicePath } from './files';

export function voiceChangeModel(lib: Library): ExtensionModel | undefined {
  return [...lib.extensionModels.values()].find((entry) => entry.task === 'a2a-vc');
}

/** The clip whose voice changes: a video sent here (its sender holds its rights), or an avatar made here. */
async function sourceOf(body: Record<string, unknown>): Promise<SpeechMeta> {
  if (typeof body.sourceJobId === 'string') {
    const record = await jobs.read(body.sourceJobId);
    const clip = record?.task === 'avatar' && record.state === 'succeeded' ? mediaFileFor(record.outputUrl) : null;
    if (!clip) throw new JobError('invalid-input');
    return saveSpeechFromFile(clip);
  }
  const speech = typeof body.speechRef === 'string' ? await readSpeechMeta(body.speechRef) : null;
  if (!speech) throw new JobError('invalid-input');
  // A video someone sent: they hold its rights, and the people in it agreed (as for a motion transfer).
  if (body.rights !== true) throw new JobError('rights-required');
  return speech;
}

/**
 * A voice change: the speech of a clip said again in the voice of a sample (Chatterbox VC),
 * words and delivery kept, then laid back under the picture. The voice sample needs its
 * speaker's consent, as for the avatar's cloned voice; the result carries the AI mention.
 */
export const voiceChangeTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('avatar');
    const model = voiceChangeModel(lib);
    if (!model) throw new JobError('extension-disabled');
    const sample = typeof body.voiceRef === 'string' ? await readVoiceMeta(body.voiceRef) : null;
    if (!sample) throw new JobError('invalid-input');
    if (body.voiceConsent !== true) throw new JobError('consent-required');
    const source = await sourceOf(body);
    return {
      inputs: { speechRef: source.speechRef, audioRef: source.audioRef, voiceRef: sample.voiceRef, duration_s: source.duration_s },
      label: { name: model.name },
      modelId: model.id,
      seed: 0,
      aspect: source.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'voice-change',
      presetId: 'voice-change',
      extension: 'avatar',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const audio = speechPath(String(record.inputs.audioRef));
        const voice = voicePath(String(record.inputs.voiceRef));
        const { workflow, output } = compileVoiceChange(model, template, { audioRef: basename(audio), voiceRef: basename(voice) });
        return { workflow, output, files: [extensionFile(model, 'audio', audio), extensionFile(model, 'voice', voice)] };
      },
    },
  ],

  async deliver(record, outputPath, dir) {
    const out = join(dir, 'voice-change.mp4');
    await replaceAudio(speechPath(String(record.inputs.speechRef)), outputPath, out);
    return { outputUrl: mediaUrlFor(out)! };
  },
};
