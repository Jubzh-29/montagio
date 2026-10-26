import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { compileMusic } from '@montagio/presets';
import { exportVertical, mixMusic, probe } from '@montagio/sequence';
import { JobError } from '../errors';
import { musicModel, requireExtension } from '../extensions';
import { mediaFileFor, mediaUrlFor } from '../generations';
import { assertNoBlockedName } from '../guards';
import type { TaskDef } from '../jobs';
import { readSequence, setSequenceMusic } from '../sequences';

const PROMPT_MAX = 300;

/**
 * An instrumental soundtrack under a finished film (ACE-Step 1.5): the music lasts the film
 * (10 s at least, cut to the film with a fade), then the film and its 9:16 cut are mixed with
 * it in the job's own folder. The silent versions of the film stay as they were.
 */
export const musicTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('music');
    const sequenceId = typeof body.sequenceId === 'string' ? body.sequenceId : '';
    const sequence = await readSequence(sequenceId);
    const film = sequence?.state === 'succeeded' ? mediaFileFor(sequence.outputUrl) : null;
    if (!sequence || !film) throw new JobError('invalid-input');
    const model = musicModel(lib);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > (model.limits.max_chars ?? PROMPT_MAX)) throw new JobError('invalid-input');
    await assertNoBlockedName(prompt);
    const bpm = body.bpm === undefined || body.bpm === null ? undefined : body.bpm;
    if (bpm !== undefined && !(Number.isInteger(bpm) && (bpm as number) >= 10 && (bpm as number) <= 300)) throw new JobError('invalid-input');
    const { duration_s } = await probe(film);
    return {
      inputs: { sequenceId, prompt, ...(bpm !== undefined ? { bpm } : {}), duration_s },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: sequence.aspect,
      parent: { source: 'sequence', id: sequenceId },
    };
  },

  steps: (record, lib) => [
    {
      name: 'music',
      presetId: 'music',
      extension: 'music',
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const bpm = typeof record.inputs.bpm === 'number' ? record.inputs.bpm : undefined;
        const { workflow, output } = compileMusic(model, template, {
          prompt: String(record.inputs.prompt),
          duration_s: Number(record.inputs.duration_s),
          seed: record.seed,
          ...(bpm !== undefined ? { bpm } : {}),
        });
        return { workflow, output, files: [] };
      },
    },
  ],

  async deliver(record, outputPath, dir) {
    const sequenceId = String(record.inputs.sequenceId);
    const film = mediaFileFor((await readSequence(sequenceId))?.outputUrl);
    if (!film) throw new Error(`the film of sequence ${sequenceId} is gone`);
    const out = join(dir, 'film.mp4');
    const vertical = join(dir, 'film-9x16.mp4');
    await mixMusic(film, outputPath, out);
    await exportVertical(out, vertical);
    await setSequenceMusic(sequenceId, record.id);
    return { outputUrl: mediaUrlFor(out)!, verticalUrl: mediaUrlFor(vertical)! };
  },
};
