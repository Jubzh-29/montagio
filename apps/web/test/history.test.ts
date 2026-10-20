import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET as getHistory } from '@/app/api/history/route';
import type { HistoryItem } from '@/lib/api-types';
import { HISTORY_LIMIT, listHistory } from '@/server/history';
import { setupTempData } from './helpers';

const dataDir = setupTempData();

const PHOTO = '00000000-0000-4000-8000-000000000001';
const GONE = '00000000-0000-4000-8000-00000000dead';

function write(kind: 'generations' | 'sequences' | 'jobs', record: Record<string, unknown>) {
  const dir = join(dataDir(), kind, String(record.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record));
}

function photo(id = PHOTO, origin = 'upload') {
  mkdirSync(join(dataDir(), 'uploads'), { recursive: true });
  writeFileSync(join(dataDir(), 'uploads', `${id}.json`), JSON.stringify({ imageRef: `uploads/${id}.png`, width: 4, height: 3, aspect: '1:1', origin, personal: origin === 'upload' }));
  return `uploads/${id}.png`;
}

const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, '0')}:00.000Z`;

const generation = (id: string, minute: number, extra: Record<string, unknown> = {}) => ({
  id,
  presetId: 'crash-push',
  modelId: 'wan22-i2v-a14b-fun-camera',
  imageRef: photo(),
  seed: 1,
  aspect: '16:9',
  state: 'succeeded',
  progress: 1,
  backendKind: 'demo',
  backendJobId: 'demo-1',
  outputUrl: `/media/data/generations/${id}/clip.mp4`,
  idempotencyKey: `key-${id}`,
  createdAt: at(minute),
  updatedAt: at(minute),
  ...extra,
});

const keys = (items: HistoryItem[]) => items.map((item) => item.key);

test('shots of a film are not listed apart', async () => {
  write('generations', generation('g-shot', 1, { idempotencyKey: 'film-key#shot0' }));
  write('sequences', {
    id: 's-1',
    imageRef: photo(),
    aspect: '16:9',
    idempotencyKey: 'film-key',
    state: 'succeeded',
    shots: [
      { presetId: 'crash-push', modelId: 'wan22-i2v-a14b-fun-camera', userPrompt: 'a harbour', state: 'succeeded', generationId: 'g-shot' },
      { presetId: 'pan-left', state: 'succeeded' },
    ],
    currentShot: 1,
    progress: 1,
    outputUrl: '/media/data/sequences/s-1/film.mp4',
    createdAt: at(2),
    updatedAt: at(3),
  });
  const items = await listHistory();
  expect(keys(items)).toEqual(['sequence:s-1']);
  expect(items[0]).toMatchObject({
    kind: 'film',
    task: 'film',
    name: 'Crash Push → Pan Left',
    modelName: 'Wan 2.2 Fun Camera',
    previewUrl: '/media/data/sequences/s-1/film.mp4',
    reprise: { tab: 'film', imageRef: `uploads/${PHOTO}.png`, shots: [{ presetId: 'crash-push', prompt: 'a harbour' }, { presetId: 'pan-left' }] },
  });
});

test('failed and canceled items are left out', async () => {
  write('generations', generation('g-ok', 1));
  write('generations', generation('g-failed', 2, { state: 'failed', outputUrl: undefined }));
  write('generations', generation('g-canceled', 3, { state: 'canceled', outputUrl: undefined }));
  expect(keys(await listHistory())).toEqual(['generation:g-ok']);
});

test(`newest first, ${HISTORY_LIMIT} at most`, async () => {
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    write('generations', generation(`g-${String(i).padStart(3, '0')}`, 0, { createdAt: new Date(Date.UTC(2026, 9, 20, 10, 0, i)).toISOString() }));
  }
  const items = await listHistory();
  expect(items).toHaveLength(HISTORY_LIMIT);
  expect(items[0]!.key).toBe(`generation:g-${String(HISTORY_LIMIT + 4).padStart(3, '0')}`);
});

test('a camera clip comes back on the camera tab, a remix with its generation id', async () => {
  write('generations', generation('g-plain', 1, { userPrompt: 'at dusk' }));
  write('generations', generation('g-remix', 2, { remix: true }));
  const [remix, plain] = await listHistory();
  expect(plain).toMatchObject({ kind: 'clip', task: 'camera', name: 'Crash Push', reprise: { tab: 'camera', presetId: 'crash-push', modelId: 'wan22-i2v-a14b-fun-camera', prompt: 'at dusk' } });
  expect(remix!.reprise).toMatchObject({ tab: 'camera', remixGenerationId: 'g-remix' });
});

test('a text-made photo comes back on the camera tab with its prompt', async () => {
  const made = photo('00000000-0000-4000-8000-000000000002', 't2i');
  write('jobs', {
    id: 'j-t2i',
    task: 't2i',
    inputs: { prompt: 'a red fox' },
    label: { name: 'Z-Image Turbo' },
    modelId: 'z-image-turbo',
    seed: 1,
    steps: [],
    current: 0,
    state: 'succeeded',
    progress: 1,
    outputUrl: `/media/data/${made}`,
    outputImageRef: made,
    idempotencyKey: 'k',
    createdAt: at(4),
    updatedAt: at(4),
  });
  const [item] = await listHistory();
  expect(item).toMatchObject({ kind: 'photo', task: 't2i', name: 'Z-Image Turbo', modelName: 'Z-Image Turbo', reprise: { tab: 'camera', imageRef: made, prompt: 'a red fox' } });
});

test('an effect comes back on the effects tab with its subject', async () => {
  write('jobs', {
    id: 'j-fx',
    task: 'effect',
    inputs: { imageRef: photo(), effectId: 'squish', subject: 'a toy car', personal: true },
    label: { itemId: 'squish', name: 'Squish' },
    modelId: 'wan21-i2v-effects',
    seed: 1,
    steps: [],
    current: 0,
    state: 'succeeded',
    progress: 1,
    outputUrl: '/media/data/jobs/j-fx/output.mp4',
    idempotencyKey: 'k2',
    createdAt: at(5),
    updatedAt: at(5),
  });
  const [item] = await listHistory();
  expect(item).toMatchObject({ kind: 'clip', task: 'effect', name: 'Squish', modelName: 'Wan 2.1 I2V 480p (effects)', reprise: { tab: 'effects', effectId: 'squish', imageRef: `uploads/${PHOTO}.png`, prompt: 'a toy car' } });
});

test('a photo that is gone gives photoMissing, never a broken imageRef', async () => {
  write('generations', generation('g-gone', 1, { imageRef: `uploads/${GONE}.png` }));
  const [item] = await listHistory();
  expect(item!.reprise).toMatchObject({ tab: 'camera', presetId: 'crash-push', photoMissing: true });
  expect(item!.reprise).not.toHaveProperty('imageRef');
});

test('GET /api/history answers the list', async () => {
  write('generations', generation('g-route', 1));
  const res = await getHistory();
  expect(res.status).toBe(200);
  expect(keys((await res.json()) as HistoryItem[])).toEqual(['generation:g-route']);
});
