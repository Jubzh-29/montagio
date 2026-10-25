import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptionExportSummary, CaptionsInfo, Transcript } from '@/lib/api-types';
import { jobDir, jobs, type JobRecord } from './jobs';
import { writeAtomic } from './store';

/** What Whisper heard, beside the transcription job's record. */
export const TRANSCRIPT_FILE = 'transcript.json';

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

async function listExports(_jobId: string): Promise<CaptionExportSummary[]> {
  return [];
}

/** GET /api/captions/:id: the transcript and the exports of a transcription job. */
export async function captionsInfo(jobId: string): Promise<CaptionsInfo | null> {
  const read = await readTranscript(jobId);
  if (!read?.record.parent) return null;
  return { jobId, parentId: read.record.parent.id, transcript: read.transcript, exports: await listExports(jobId) };
}

/** Burn the captions in at once (a recipe replayed): the 9:16 clip's URL. */
export async function exportNow(_record: JobRecord, _transcript: Transcript, _body: { text: string; style: string; language: string }): Promise<{ url: string }> {
  throw new Error('captions export: not implemented yet');
}
