import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { evenWords, isCaptionLanguage, parseWordsDoc, wordsFromChunks, type WordsDoc } from '@montagio/captions';
import { compileTranscribe } from '@montagio/presets';
import { extractSpeech, probe, probeAudio } from '@montagio/sequence';
import type { Transcript } from '@/lib/api-types';
import { exportNow, readExportRequest, TRANSCRIPT_FILE, writeTranscript, type CaptionExportRequest } from '../captions';
import { JobError } from '../errors';
import { captionsRejected, markCaptionsRejected, requireExtension, transcribeModel } from '../extensions';
import { mediaFileFor, mediaUrlFor } from '../generations';
import { jobDir, jobs, type JobRecord, type TaskDef } from '../jobs';
import { extensionFile } from './files';

/** The clips that speak: what captions are made for. */
export const CAPTIONABLE_TASKS = ['avatar', 'translate', 'voice-change'] as const;
/** The longest clip captioned: the talking clips last 30 s at most today. */
export const CAPTION_CLIP_MAX_S = 60;
const SPEECH_FILE = 'speech.flac';

/** The finished talking clip a transcription starts from. */
async function parentClip(parent: unknown): Promise<{ record: JobRecord; clip: string }> {
  const { source, id } = (parent ?? {}) as { source?: unknown; id?: unknown };
  if (source !== 'job' || typeof id !== 'string') throw new JobError('invalid-input');
  const record = await jobs.read(id);
  const clip = record?.state === 'succeeded' && record.outputUrl?.endsWith('.mp4') ? mediaFileFor(record.outputUrl) : null;
  if (!record || !clip || !(CAPTIONABLE_TASKS as readonly string[]).includes(record.task)) throw new JobError('invalid-input');
  return { record, clip };
}

/** What a talking clip's parent typed, when it is an avatar: the text the captions start from. */
function typedText(parent: JobRecord | null): { text: string; language?: string } | null {
  if (parent?.task !== 'avatar' || typeof parent.inputs.text !== 'string' || !parent.inputs.text.trim()) return null;
  return { text: parent.inputs.text.trim(), ...(typeof parent.inputs.language === 'string' ? { language: parent.inputs.language } : {}) };
}

/**
 * The transcript of what Whisper wrote: its words joined and bounded, the text the editor starts from
 * (an avatar's typed text, else what was heard) and whether captions are made in that language. The
 * demo has no Whisper: it gives the real transcription of its example clip, or spreads the typed text
 * over the voice, and says so.
 */
export function buildTranscript(
  doc: WordsDoc,
  context: { demo: boolean; parentIsExample: boolean; typed: { text: string; language?: string } | null; speech_s: number },
): Transcript {
  const duration_s = doc.duration_s > 0 ? doc.duration_s : context.speech_s;
  const spread = context.demo && !context.parentIsExample && context.typed !== null;
  const words = spread ? evenWords(context.typed!.text, context.speech_s || duration_s) : wordsFromChunks(doc.chunks, duration_s);
  const language = spread ? (context.typed!.language ?? doc.language) : doc.language;
  const heard = doc.text.trim() || words.map((word) => word.text).join(' ');
  return {
    language,
    detected: doc.detected,
    supported: isCaptionLanguage(language),
    model: doc.model,
    duration_s: spread ? context.speech_s || duration_s : duration_s,
    words,
    heard,
    suggested: context.typed?.text ?? heard,
    ...(context.demo ? { demo: true as const } : {}),
  };
}

/**
 * Captions of a talking clip, step one: Whisper (Montagio Transcribe Words) hears its speech and writes
 * each word with its moment. The transcription is optional within the extension "avatar": a refused
 * workflow hides the captions alone. With `export` (a recipe replayed), the job burns the captions in
 * at once, on the corrected text and in the style given.
 */
export const captionsTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('avatar');
    const model = transcribeModel(lib);
    if (!model || captionsRejected()) throw new JobError('extension-disabled');
    const language = body.language === undefined ? 'auto' : body.language;
    if (language !== 'auto' && !isCaptionLanguage(language)) throw new JobError('language-unsupported');
    const exportRequest = body.export === undefined ? undefined : readExportRequest(body.export);
    const { record, clip } = await parentClip(body.parent);
    if (!(await probeAudio(clip))) throw new JobError('no-speech');
    if ((await probe(clip)).duration_s > CAPTION_CLIP_MAX_S) throw new JobError('invalid-input');
    return {
      inputs: { clipUrl: record.outputUrl, language, ...(exportRequest ? { export: exportRequest } : {}) },
      label: { name: model.name },
      modelId: model.id,
      seed: 0,
      aspect: '9:16',
      parent: { source: 'job', id: record.id },
    };
  },

  steps: (record, lib) => [
    {
      name: 'transcribe',
      presetId: 'captions',
      // No extension: Whisper missing from a ComfyUI must not hide the avatar, the voice change and the translation.
      extension: null,
      onRejected: markCaptionsRejected,
      compile: async () => {
        const model = lib.extensionModels.get(record.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        const clip = mediaFileFor(String(record.inputs.clipUrl));
        if (!template || !clip) throw new Error(`captions: no workflow for ${model.id}, or the clip is gone`);
        // The first step compiles before the engine writes the job's folder.
        await mkdir(jobDir(record.id), { recursive: true });
        const speech = join(jobDir(record.id), SPEECH_FILE);
        await extractSpeech(clip, speech, { max_s: CAPTION_CLIP_MAX_S });
        const { workflow, output } = compileTranscribe(model, template, { audioRef: basename(speech), language: String(record.inputs.language) });
        return { workflow, output, files: [extensionFile(model, 'audio', speech)] };
      },
    },
  ],

  async deliver(record, outputPath, dir) {
    const doc = parseWordsDoc(JSON.parse(await readFile(outputPath, 'utf8')));
    const parent = record.parent ? await jobs.read(record.parent.id) : null;
    const transcript = buildTranscript(doc, {
      demo: record.backendKind === 'demo',
      parentIsExample: parent?.demo === 'example',
      typed: typedText(parent),
      speech_s: (await probeAudio(join(dir, SPEECH_FILE)))?.duration_s ?? 0,
    });
    await writeTranscript(record.id, transcript);
    const requested = record.inputs.export as CaptionExportRequest | undefined;
    if (requested) return { outputUrl: (await exportNow(record, transcript, requested)).url };
    return { outputUrl: mediaUrlFor(join(dir, TRANSCRIPT_FILE))! };
  },
};
