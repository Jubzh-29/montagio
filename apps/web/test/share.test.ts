import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RECIPE_TAG, probe, readTags } from '@montagio/sequence';
import { POST as postGeneration } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postShare } from '@/app/api/share/route';
import { GET as getShare } from '@/app/api/share/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { t } from '@/i18n';
import type { ShareSummary } from '@/lib/api-types';
import { shareCaption, shareKindOfTask } from '@/lib/share';
import { mediaFileFor } from '@/server/generations';
import { generationRequest, params, setupTempData } from './helpers';

const dataDir = setupTempData();
beforeEach(() => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});

const share = (body: unknown, headers: Record<string, string> = {}) =>
  postShare(new Request('http://localhost/api/share', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

async function cameraClip(): Promise<string> {
  const imageRef = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const { id } = (await (await postGeneration(generationRequest({ presetId: 'slow-push', imageRef }, crypto.randomUUID()))).json()) as { id: string };
  let state = '';
  for (let i = 0; i < 20 && state !== 'succeeded'; i++) state = ((await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json()) as { state: string }).state;
  expect(state).toBe('succeeded');
  return id;
}

async function finished(id: string): Promise<ShareSummary> {
  for (let i = 0; i < 600; i++) {
    const state = (await (await getShare(new Request('http://localhost/x'), params({ id }))).json()) as ShareSummary;
    if (state.state !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the share did not end');
}

/** The grey levels of the end card's band (the top of the frame, above the 16:9 picture) in the clip's last frame. */
function cardBand(clip: string): Buffer {
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-sseof', '-0.3', '-i', clip, '-vf', 'crop=900:90:90:520,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-']);
}

const meanDifference = (a: Buffer, b: Buffer) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;

test('a camera clip goes out in 9:16 with the AI mention and its recipe, and ends on the Montagio card unless it is unticked', async () => {
  const id = await cameraClip();
  const withCard = await share({ source: 'generation', id, endCard: true });
  expect(withCard.status).toBe(202);
  const started = (await withCard.json()) as ShareSummary;
  expect(started).toMatchObject({ endCard: true, state: 'running' });
  const done = await finished(started.id);
  expect(done.state).toBe('succeeded');
  const clip = mediaFileFor(done.url)!;
  expect(done.url).toMatch(/^\/media\/data\/shares\/[a-z0-9]+-[0-9a-f]{4}\/montagio-9x16\.mp4$/);
  expect(await probe(clip)).toMatchObject({ width: 1080, height: 1920 });
  const tags = await readTags(clip);
  expect(tags.comment).toBe('AI-generated');
  expect(JSON.parse(tags[RECIPE_TAG.video]!)).toMatchObject({ schema: 'montagio/recipe@1', compact: true, kind: 'clip' });
  expect(existsSync(join(dataDir(), 'shares', started.id, 'endcard.ass'))).toBe(true);

  const plain = await finished(((await (await share({ source: 'generation', id, endCard: false })).json()) as ShareSummary).id);
  expect(plain).toMatchObject({ state: 'succeeded', endCard: false });
  expect(existsSync(join(dataDir(), 'shares', plain.id, 'endcard.ass'))).toBe(false);
  // The card is drawn where it says: its band differs between the two last frames, and the clip stays the same length.
  expect(meanDifference(cardBand(clip), cardBand(mediaFileFor(plain.url)!))).toBeGreaterThan(8);
  expect(Math.abs((await probe(clip)).duration_s - (await probe(mediaFileFor(plain.url)!)).duration_s)).toBeLessThan(0.1);
}, 120_000);

test('only a finished video result of this app is shared, and only from its own pages', async () => {
  const id = await cameraClip();
  for (const body of [{ source: 'generation', id }, { source: 'upload', id, endCard: true }, { source: 'job', id: '../x', endCard: true }, { source: 'job', id, endCard: 'yes' }]) {
    const res = await share(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-input' });
  }
  expect((await share({ source: 'job', id, endCard: true })).status).toBe(404);
  expect((await share({ source: 'sequence', id: 'nope', endCard: true })).status).toBe(404);
  expect((await share({ source: 'generation', id, endCard: true }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  const asText = await postShare(new Request('http://localhost/api/share', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ source: 'generation', id, endCard: true }) }));
  expect(asText.status).toBe(403);
  expect((await getShare(new Request('http://localhost/x'), params({ id: '../../etc' }))).status).toBe(404);
});

describe('the caption to paste', () => {
  const en = (key: Parameters<typeof t>[0], vars?: Record<string, string | number>) => t(key, 'en', vars);
  const fr = (key: Parameters<typeof t>[0], vars?: Record<string, string | number>) => t(key, 'fr', vars);

  test('names the result and its model, says it is AI-generated, then the hashtags', () => {
    expect(shareCaption(en, { kind: 'camera', title: 'Crash Push', model: { name: 'Wan 2.2', license: 'Apache-2.0' } })).toBe(
      'Crash Push: one photo, one camera move.\nAI-generated with Wan 2.2 (Apache-2.0), open weights. Made with Montagio.\n\n#AIgenerated #Montagio #opensource #cameramove',
    );
    expect(shareCaption(fr, { kind: 'film' })).toBe(
      'Un court métrage tourné à partir d’une seule photo.\nGénéré par IA avec des modèles à poids ouverts. Fait avec Montagio.\n\n#AIgenerated #Montagio #opensource #shortfilm',
    );
    expect(shareCaption(en, { kind: 'clip', title: '  ' })).toMatch(/^This clip, made from one photo\./);
  });

  test('a captions export shares as the clip it was made from', () => {
    expect(shareKindOfTask('captions', 'translate')).toBe('translate');
    expect(shareKindOfTask('hook')).toBe('effect');
    expect(shareKindOfTask('music')).toBe('film');
    expect(shareKindOfTask('t2i')).toBe('clip');
  });
});
