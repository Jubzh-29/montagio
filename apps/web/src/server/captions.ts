import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { alignText, buildAss, CAPTION_STYLES, isCaptionLanguage, isCaptionStyle, segmentWords, type CaptionStyleId } from '@montagio/captions';
import { compactRecipe } from '@montagio/recipe';
import { AI_METADATA, captionFrame, RECIPE_TAG, renderVertical } from '@montagio/sequence';
import type { CaptionExportSummary, CaptionsInfo, Transcript } from '@/lib/api-types';
import { copyCaptionFonts } from './caption-fonts';
import { JobError } from './errors';
import { mediaFileFor, mediaUrlFor } from './generations';
import { jobDir, jobs, updateJob, type JobRecord } from './jobs';
import { captionsExportRecipe, replaceJobRecipe } from './recipe';
import { writeAtomic } from './store';

/** What Whisper heard, beside the transcription job's record. */
export const TRANSCRIPT_FILE = 'transcript.json';
const EXPORTS = 'exports';
const PREVIEWS = 'previews';
const ASS_FILE = 'captions.ass';
const VIDEO_FILE = 'video.mp4';
const STATE_FILE = 'state.json';
const EXPORT_ID = /^[a-z0-9]{1,16}-[0-9a-f]{4}$/;

/** The corrected text of a captions export, in characters. */
export const CAPTION_TEXT_MAX = 2000;

export type CaptionExportRequest = { text: string; style: CaptionStyleId };

/** A corrected text and a style, as an export takes them; anything else is invalid-input. */
export function readExportRequest(value: unknown): CaptionExportRequest {
  const { text, style } = (value && typeof value === 'object' ? value : {}) as { text?: unknown; style?: unknown };
  if (typeof text !== 'string' || !text.trim() || text.length > CAPTION_TEXT_MAX || !isCaptionStyle(style)) throw new JobError('invalid-input');
  return { text: text.trim(), style };
}

/** A corrected text, its style and its language: what an export, a preview or a replay burns in. */
export type CaptionsRequest = { text: string; style: CaptionStyleId; language: string };

export class CaptionsNotFound extends Error {}

export async function writeTranscript(jobId: string, transcript: Transcript): Promise<void> {
  await writeAtomic(join(jobDir(jobId), TRANSCRIPT_FILE), JSON.stringify(transcript, null, 2));
}

/** The transcript of a finished transcription job; null for any other job, or one not delivered yet. */
export async function readTranscript(jobId: string): Promise<{ record: JobRecord; transcript: Transcript } | null> {
  const record = await jobs.read(jobId);
  if (record?.task !== 'captions' || record.state !== 'succeeded') return null;
  try {
    return { record, transcript: JSON.parse(await readFile(join(jobDir(jobId), TRANSCRIPT_FILE), 'utf8')) as Transcript };
  } catch {
    return null;
  }
}

/** The text, the style and the language of a request, against the transcript: language-unsupported or invalid-input otherwise. */
function captionsRequest(body: unknown, transcript: Transcript): CaptionsRequest {
  const language = (body as { language?: unknown } | null)?.language ?? transcript.language;
  if (!isCaptionLanguage(language)) throw new JobError('language-unsupported');
  return { ...readExportRequest(body), language };
}

/** The ASS script of a request and the fonts it names, in `dir`, where FFmpeg will run. */
async function writeLayer(dir: string, transcript: Transcript, request: CaptionsRequest) {
  const words = alignText(transcript.words, request.text, transcript.duration_s);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ASS_FILE), buildAss({ language: request.language, words }, request.style));
  await copyCaptionFonts(dir);
  return { words, layer: { dir, ass: ASS_FILE, fonts: 'fonts' } };
}

function clipOf(record: JobRecord): string {
  const clip = mediaFileFor(String(record.inputs.clipUrl));
  if (!clip) throw new Error(`captions ${record.id}: the talking clip is gone`);
  return clip;
}

/** Render one export in `dir`: the 9:16 clip with the captions burned in, the AI mention and the export's recipe, in the file and beside the job. */
async function renderExport(record: JobRecord, transcript: Transcript, request: CaptionsRequest, dir: string): Promise<string> {
  const { layer } = await writeLayer(dir, transcript, request);
  const recipe = await captionsExportRecipe(record.id, request);
  const video = join(dir, VIDEO_FILE);
  await renderVertical(clipOf(record), video, { captions: layer, tags: { ...AI_METADATA, ...(recipe ? { [RECIPE_TAG.video]: compactRecipe(recipe) } : {}) } });
  if (recipe) await replaceJobRecipe(record.id, recipe);
  return video;
}

const newExportId = () => `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
const exportDir = (jobId: string, exportId: string) => join(jobDir(jobId), EXPORTS, exportId);
const writeState = (dir: string, state: CaptionExportSummary) => writeAtomic(join(dir, STATE_FILE), JSON.stringify(state, null, 2));

// Exports run one at a time, whoever asks (two 1080x1920 encodes at once would only heat the machine), and the
// one running is known to every route bundle of this process: a "running" state without it was cut by a restart.
const holder = globalThis as typeof globalThis & { __montagioCaptionExports?: { queue: Promise<unknown>; running: Set<string> } };
const exportsInFlight = (holder.__montagioCaptionExports ??= { queue: Promise.resolve(), running: new Set() });

/** POST /api/captions/:id/export: an export starts (or waits its turn); its state is polled. */
export async function startExport(jobId: string, body: unknown): Promise<CaptionExportSummary> {
  const read = await readTranscript(jobId);
  if (!read) throw new CaptionsNotFound(jobId);
  const request = captionsRequest(body, read.transcript);
  const id = newExportId();
  const dir = exportDir(jobId, id);
  const state: CaptionExportSummary = { id, style: request.style, state: 'running', createdAt: new Date().toISOString() };
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, 'request.json'), JSON.stringify(request, null, 2));
  await writeState(dir, state);
  const key = `${jobId}/${id}`;
  exportsInFlight.running.add(key);
  const work = exportsInFlight.queue.then(async () => {
    try {
      const url = mediaUrlFor(await renderExport(read.record, read.transcript, request, dir))!;
      await writeState(dir, { ...state, state: 'succeeded', url });
      // The job's result is its last export finished.
      await updateJob(jobId, (record) => (record.outputUrl = url));
    } catch (error) {
      console.error(`[montagio] captions ${jobId}: the export ${id} failed`, error);
      await writeState(dir, { ...state, state: 'failed', error: 'export-failed' });
    } finally {
      exportsInFlight.running.delete(key);
    }
  });
  exportsInFlight.queue = work;
  return state;
}

/** GET /api/captions/:id/export/:exportId; null for an unknown export. */
export async function exportState(jobId: string, exportId: string): Promise<CaptionExportSummary | null> {
  if (!EXPORT_ID.test(exportId) || !(await readTranscript(jobId))) return null;
  const dir = exportDir(jobId, exportId);
  let state: CaptionExportSummary;
  try {
    state = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8')) as CaptionExportSummary;
  } catch {
    return null;
  }
  if (state.state === 'running' && !exportsInFlight.running.has(`${jobId}/${exportId}`)) {
    state = { ...state, state: 'failed', error: 'interrupted' };
    await writeState(dir, state);
  }
  return state;
}

async function listExports(jobId: string): Promise<CaptionExportSummary[]> {
  let names: string[];
  try {
    names = await readdir(join(jobDir(jobId), EXPORTS));
  } catch {
    return [];
  }
  const states = await Promise.all(names.sort().map((name) => exportState(jobId, name)));
  return states.filter((state): state is CaptionExportSummary => state !== null);
}

/** GET /api/captions/:id: the transcript and the exports of a transcription job. */
export async function captionsInfo(jobId: string): Promise<CaptionsInfo | null> {
  const read = await readTranscript(jobId);
  if (!read?.record.parent) return null;
  return { jobId, parentId: read.record.parent.id, transcript: read.transcript, exports: await listExports(jobId) };
}

/** Burn the captions in at once (a recipe replayed, inside the job's delivery): the 9:16 clip's URL. */
export async function exportNow(record: JobRecord, transcript: Transcript, body: { text: string; style: CaptionStyleId; language: string }): Promise<{ url: string }> {
  const request = captionsRequest(body, transcript);
  const id = newExportId();
  const dir = exportDir(record.id, id);
  const url = mediaUrlFor(await renderExport(record, transcript, request, dir))!;
  await writeState(dir, { id, style: request.style, state: 'succeeded', url, createdAt: new Date().toISOString() });
  return { url };
}

// Previews being made, by file: two requests for the same frame share one FFmpeg.
const previewHolder = globalThis as typeof globalThis & { __montagioCaptionPreviews?: Map<string, Promise<string>> };
const previews = (previewHolder.__montagioCaptionPreviews ??= new Map());

/**
 * POST /api/captions/:id/preview: one frame of the export, made by the same FFmpeg and libass, in the
 * middle of the first line of captions, 540x960. Kept per text and style: the same request answers at once.
 */
export async function previewFrame(jobId: string, body: unknown): Promise<string> {
  const read = await readTranscript(jobId);
  if (!read) throw new CaptionsNotFound(jobId);
  const request = captionsRequest(body, read.transcript);
  const key = createHash('sha256').update(`${request.style}\n${request.language}\n${request.text}`).digest('hex').slice(0, 16);
  const dir = join(jobDir(jobId), PREVIEWS, key);
  const png = join(dir, 'frame.png');
  let made = previews.get(png);
  if (!made) {
    made = (async () => {
      if (await access(png).then(() => true, () => false)) return png;
      const { words, layer } = await writeLayer(dir, read.transcript, request);
      const first = segmentWords(words, CAPTION_STYLES[request.style].rules)[0];
      await captionFrame(clipOf(read.record), png, { at_s: first ? (first.start + first.end) / 2 : 0, captions: layer, width: 540 });
      return png;
    })().finally(() => previews.delete(png));
    previews.set(png, made);
  }
  return made;
}
