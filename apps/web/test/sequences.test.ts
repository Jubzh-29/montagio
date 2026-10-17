import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probe } from '@montagio/sequence';
import { POST as postSequence } from '@/app/api/sequences/route';
import { GET as getSequence } from '@/app/api/sequences/[id]/route';
import { POST as cancelSequenceRoute } from '@/app/api/sequences/[id]/cancel/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { params, pngFile, seedRecordFile, setupTempData, uploadRequest } from './helpers';

const dataDir = setupTempData();
const threeShots = [{ presetId: 'crash-push' }, { presetId: 'pan-left' }, { presetId: 'slow-push' }];

function sequenceRequest(body: unknown, key: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['idempotency-key'] = key;
  return new Request('http://localhost/api/sequences', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function uploadedImageRef(): Promise<string> {
  return ((await (await postUpload(uploadRequest(pngFile(1920, 1080)))).json()) as { imageRef: string }).imageRef;
}

async function getSeq(id: string) {
  return (await getSequence(new Request(`http://localhost/api/sequences/${id}`), params({ id }))).json();
}

async function pollUntil(id: string, states: string[], timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const record = await getSeq(id);
    if (states.includes(record.state)) return record;
    if (Date.now() > end) throw new Error(`sequence stuck in ${record.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function seedSequence(record: Record<string, unknown>): void {
  const dir = join(dataDir(), 'sequences', String(record.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record));
}

describe('validation', () => {
  test.each([[1], [4]])('%i shot(s) -> 400 invalid-shots', async (count) => {
    const imageRef = await uploadedImageRef();
    const shots = Array.from({ length: count }, () => ({ presetId: 'crash-push' }));
    const res = await postSequence(sequenceRequest({ imageRef, shots }, `n${count}`));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-shots' });
  });

  test('missing Idempotency-Key -> 400', async () => {
    const res = await postSequence(sequenceRequest({ imageRef: 'uploads/x.png', shots: threeShots }, null));
    expect(await res.json()).toEqual({ error: 'missing-idempotency-key' });
  });

  test('an unknown preset in a later shot is refused before any render', async () => {
    const imageRef = await uploadedImageRef();
    const shots = [{ presetId: 'crash-push' }, { presetId: 'nope' }];
    const res = await postSequence(sequenceRequest({ imageRef, shots }, 'bad-preset'));
    expect(await res.json()).toEqual({ error: 'unknown-preset' });
    expect(existsSync(join(dataDir(), 'generations'))).toBe(false);
  });

  test('an unknown image -> 400 unknown-image', async () => {
    const res = await postSequence(sequenceRequest({ imageRef: 'uploads/missing.png', shots: threeShots }, 'no-image'));
    expect(await res.json()).toEqual({ error: 'unknown-image' });
  });
});

describe('flow', () => {
  test('three shots chain from last frames and assemble a 16:9 film and a 9:16 cut', async () => {
    process.env.MONTAGIO_DEMO_DURATION_MS = '0';
    const imageRef = await uploadedImageRef();
    const res = await postSequence(sequenceRequest({ imageRef, shots: threeShots }, 'film'));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ state: 'running', currentShot: 0 });

    const done = await pollUntil(created.id, ['succeeded', 'failed']);
    expect(done.state).toBe('succeeded');
    expect(done.progress).toBe(1);
    expect(done.outputUrl).toBe(`/media/data/sequences/${created.id}/film.mp4`);
    expect(done.verticalUrl).toBe(`/media/data/sequences/${created.id}/film-9x16.mp4`);
    for (const shot of done.shots.slice(1)) {
      expect(shot.startImageRef).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
      expect(existsSync(join(dataDir(), shot.startImageRef))).toBe(true);
    }

    const film = await probe(join(dataDir(), 'sequences', created.id, 'film.mp4'));
    expect(film).toMatchObject({ width: 832, height: 480 });
    expect(film.duration_s).toBeGreaterThan(14.7);
    expect(film.duration_s).toBeLessThan(15.4);
    expect(await probe(join(dataDir(), 'sequences', created.id, 'film-9x16.mp4'))).toMatchObject({
      width: 720,
      height: 1280,
    });
  }, 90_000);

  test('same key twice -> same sequence (201 then 200)', async () => {
    const imageRef = await uploadedImageRef();
    const a = await postSequence(sequenceRequest({ imageRef, shots: threeShots }, 'dup'));
    const b = await postSequence(sequenceRequest({ imageRef, shots: threeShots }, 'dup'));
    expect([a.status, b.status]).toEqual([201, 200]);
    expect((await b.json()).id).toBe((await a.json()).id);
  });

  test('cancel -> canceled', async () => {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postSequence(sequenceRequest({ imageRef, shots: threeShots }, 'cancel'))).json();
    const res = await cancelSequenceRoute(new Request('http://localhost/x', { method: 'POST' }), params({ id }));
    expect(await res.json()).toMatchObject({ id, state: 'canceled' });
    expect(await getSeq(id)).toMatchObject({ state: 'canceled' });
  });

  test('an unknown sequence -> 404', async () => {
    const res = await getSequence(new Request('http://localhost/x'), params({ id: 'nope' }));
    expect(res.status).toBe(404);
  });
});

describe('resilience', () => {
  const now = '2026-10-17T00:00:00.000Z';
  const base = {
    imageRef: 'uploads/x.png',
    aspect: '16:9',
    idempotencyKey: 'seeded',
    createdAt: now,
    updatedAt: now,
    progress: 0.3,
  };

  test('a lost shot fails the sequence', async () => {
    seedSequence({
      ...base,
      id: 'lost-seq',
      state: 'running',
      currentShot: 0,
      shots: [
        { presetId: 'crash-push', generationId: 'gone', state: 'running' },
        { presetId: 'pan-left', state: 'pending' },
      ],
    });
    expect(await getSeq('lost-seq')).toMatchObject({ state: 'failed', error: 'lost' });
  });

  test('an interrupted montage resumes on the next GET', async () => {
    for (const id of ['g1', 'g2']) {
      seedRecordFile(dataDir(), {
        id,
        presetId: 'crash-push',
        modelId: 'wan22-i2v-a14b-fun-camera',
        imageRef: 'uploads/x.png',
        seed: 1,
        aspect: '16:9',
        state: 'succeeded',
        progress: 1,
        backendKind: 'demo',
        backendJobId: `demo-${id}`,
        outputUrl: '/media/demo-assets/clips/crash-push.mp4',
        idempotencyKey: id,
        createdAt: now,
        updatedAt: now,
      });
    }
    seedSequence({
      ...base,
      id: 'resume-seq',
      state: 'assembling',
      currentShot: 1,
      shots: [
        { presetId: 'crash-push', generationId: 'g1', state: 'succeeded' },
        { presetId: 'crash-push', generationId: 'g2', state: 'succeeded' },
      ],
    });
    const done = await pollUntil('resume-seq', ['succeeded', 'failed']);
    expect(done).toMatchObject({ state: 'succeeded', outputUrl: '/media/data/sequences/resume-seq/film.mp4' });
  }, 90_000);
});
