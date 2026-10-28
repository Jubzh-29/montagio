import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEndCardAss, END_CARD_FONT } from '@montagio/captions';
import { AI_METADATA, ensureTools, probe, renderVertical } from '@montagio/sequence';
import type { ShareSummary } from '@/lib/api-types';
import { isRecipeSource, type RecipeSource } from '@/lib/recipe-url';
import { copyCaptionFonts } from './caption-fonts';
import { enqueueVerticalRender } from './captions';
import { withDataWrite } from './data-purge';
import { getEnv } from './env';
import { JobError } from './errors';
import { mediaFileFor, mediaUrlFor } from './generations';
import { jobs } from './jobs';
import { recipeTags } from './recipe';
import { readSequence } from './sequences';
import { readRecord, writeAtomic } from './store';

const SHARE_ID = /^[a-z0-9]{1,16}-[0-9a-f]{4}$/;
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const STATE_FILE = 'state.json';
const END_CARD_FILE = 'endcard.ass';
const VIDEO_FILE = 'montagio-9x16.mp4';

/** A finished result to share: what made it, and whether the 9:16 clip ends on the "Made with Montagio" card. */
export type ShareRequest = { source: RecipeSource; id: string; endCard: boolean };

export class ShareSourceNotFound extends Error {}

/** The request of POST /api/share; anything else is invalid-input. */
export function readShareRequest(value: unknown): ShareRequest {
  const { source, id, endCard } = (value && typeof value === 'object' ? value : {}) as { source?: unknown; id?: unknown; endCard?: unknown };
  if (typeof source !== 'string' || !isRecipeSource(source) || typeof id !== 'string' || !SAFE_ID.test(id) || typeof endCard !== 'boolean') {
    throw new JobError('invalid-input');
  }
  return { source, id, endCard };
}

/**
 * The video file of a finished result, the one its 9:16 starts from: the clip or the film as delivered, and for a
 * trend remix its own 9:16 (its captions burned in). Null for a result not finished, gone, or that is not a video.
 */
export async function shareInput(source: RecipeSource, id: string): Promise<string | null> {
  let url: string | undefined;
  if (source === 'generation') {
    const record = await readRecord(id);
    if (record?.state === 'succeeded') url = record.outputUrl;
  } else if (source === 'job') {
    const record = await jobs.read(id);
    if (record?.state === 'succeeded') url = record.task === 'remix' ? (record.verticalUrl ?? record.outputUrl) : record.outputUrl;
  } else {
    const record = await readSequence(id);
    if (record?.state === 'succeeded') url = record.outputUrl;
  }
  return url?.endsWith('.mp4') ? mediaFileFor(url) : null;
}

const newShareId = () => `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
const sharesDir = () => join(getEnv().data, 'shares');
const shareDir = (id: string) => join(sharesDir(), id);
const writeState = (dir: string, state: ShareSummary) => writeAtomic(join(dir, STATE_FILE), JSON.stringify(state, null, 2));

// The share being rendered, known to every route bundle of this process: a "running" state without it was cut by a restart.
const holder = globalThis as typeof globalThis & { __montagioShares?: Set<string> };
const running = (holder.__montagioShares ??= new Set());

/** The 9:16 clip of a result in `dir`: 1080x1920, the end card burned in when asked, the AI mention and the result's recipe in the file. */
async function renderShare(input: string, request: ShareRequest, dir: string): Promise<string> {
  const tags = { ...AI_METADATA, ...(await recipeTags(request.source, request.id, 'video')) };
  let endCard;
  if (request.endCard) {
    const { duration_s } = await probe(input);
    await writeFile(join(dir, END_CARD_FILE), buildEndCardAss(duration_s));
    await copyCaptionFonts(dir, [END_CARD_FONT.file]);
    endCard = { dir, ass: END_CARD_FILE, fonts: 'fonts' };
  }
  const video = join(dir, VIDEO_FILE);
  await renderVertical(input, video, { ...(endCard ? { captions: endCard } : {}), tags });
  return video;
}

/** POST /api/share: the 9:16 clip of a finished result starts rendering (after the exports before it); its state is polled. */
export async function startShare(body: unknown): Promise<ShareSummary> {
  return withDataWrite(async () => {
    const request = readShareRequest(body);
  const input = await shareInput(request.source, request.id);
  if (!input) throw new ShareSourceNotFound(`${request.source} ${request.id}`);
  try {
    await ensureTools();
  } catch {
    throw new JobError('ffmpeg-missing');
  }
  const id = newShareId();
  const dir = shareDir(id);
  const state: ShareSummary = { id, endCard: request.endCard, state: 'running', createdAt: new Date().toISOString() };
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, 'request.json'), JSON.stringify(request, null, 2));
  await writeState(dir, state);
  running.add(id);
  void enqueueVerticalRender(async () => {
    try {
      await writeState(dir, { ...state, state: 'succeeded', url: mediaUrlFor(await renderShare(input, request, dir))! });
    } catch (error) {
      console.error(`[montagio] share ${id} of ${request.source} ${request.id} failed`, error);
      await writeState(dir, { ...state, state: 'failed', error: 'export-failed' });
    } finally {
      running.delete(id);
    }
  }).catch((error: unknown) => console.error(`[montagio] share ${id}: could not record its end`, error));
    return state;
  });
}

/** GET /api/share/:id; null for an unknown share. */
export async function shareState(id: string): Promise<ShareSummary | null> {
  if (!SHARE_ID.test(id)) return null;
  let state: ShareSummary;
  try {
    state = JSON.parse(await readFile(join(shareDir(id), STATE_FILE), 'utf8')) as ShareSummary;
  } catch {
    return null;
  }
  if (state.state === 'running' && !running.has(id)) {
    state = { ...state, state: 'failed', error: 'interrupted' };
    await writeState(shareDir(id), state);
  }
  return state;
}
