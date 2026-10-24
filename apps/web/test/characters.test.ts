import { DELETE as deleteCharacter, GET as getCharacter } from '@/app/api/characters/[id]/route';
import { POST as postPhoto } from '@/app/api/characters/[id]/photos/route';
import { GET as listCharacters, POST as postCharacter } from '@/app/api/characters/route';
import { POST as postEdits } from '@/app/api/edits/route';
import { GET as getHistory } from '@/app/api/history/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { CharacterSummary, HistoryItem, JobSummary } from '@/lib/api-types';
import { characterPrompt, photodumpInstruction, photodumpScene, placeOf, scenePhrase } from '@/lib/characters';
import { params, pngFile, setupTempData, uploadRequest } from './helpers';

setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const request = (body: unknown, key?: string) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('job did not settle');
}

async function portrait(key: string): Promise<JobSummary> {
  const res = await postImages(request({ prompt: characterPrompt('bold', 'short silver hair, red bomber jacket'), aspect: '9:16' }, key));
  return poll(((await res.json()) as JobSummary).id);
}

const save = async (body: Record<string, unknown>) => postCharacter(request(body));

test('a portrait made from a text becomes a character, listed and read back', async () => {
  const job = await portrait('c-portrait-1');
  const res = await save({ name: 'Nova', type: 'bold', description: 'short silver hair, red bomber jacket', imageRef: job.outputImageRef, jobId: job.id });
  expect(res.status).toBe(201);
  const character = (await res.json()) as CharacterSummary;
  expect(character).toMatchObject({
    name: 'Nova',
    type: 'bold',
    imageRef: job.outputImageRef,
    imageUrl: `/media/data/${job.outputImageRef}`,
    portraitHistoryKey: `job:${job.id}`,
    photos: [],
  });
  const list = (await (await listCharacters()).json()) as CharacterSummary[];
  expect(list.map((entry) => entry.id)).toContain(character.id);
  expect(await (await getCharacter(new Request('http://localhost/x'), params({ id: character.id }))).json()).toEqual(character);
});

test('a character is never a photo of someone: imported, sample and unknown photos are refused', async () => {
  const imported = ((await (await postUpload(uploadRequest(pngFile(720, 1280)))).json()) as { imageRef: string }).imageRef;
  const sample = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  for (const imageRef of [imported, sample]) {
    const res = await save({ name: 'X', type: 'everyday', description: 'someone', imageRef });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-input' });
  }
  // An edit carries the mark of its source: an edit of a sample is no character either.
  const edit = await postEdits(request({ imageRef: sample, instruction: 'make it snow' }, 'c-edit-sample'));
  const edited = await poll(((await edit.json()) as JobSummary).id);
  expect((await save({ name: 'X', type: 'everyday', description: 'someone', imageRef: edited.outputImageRef })).status).toBe(400);
  const unknown = await save({ name: 'X', type: 'everyday', description: 'someone', imageRef: 'uploads/nope.png' });
  expect(await unknown.json()).toEqual({ error: 'unknown-image' });
});

test('a character needs a name, a known type and a description; a blocked name is refused', async () => {
  const job = await portrait('c-portrait-2');
  for (const body of [
    { type: 'bold', description: 'x' },
    { name: 'N', type: 'wizard', description: 'x' },
    { name: 'N', type: 'bold' },
    { name: 'N'.repeat(41), type: 'bold', description: 'x' },
  ]) {
    expect((await save({ ...body, imageRef: job.outputImageRef })).status).toBe(400);
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const blocked = await save({ name: 'Taylor Swift', type: 'bold', description: 'x', imageRef: job.outputImageRef });
  expect(await blocked.json()).toEqual({ error: 'blocked-name' });
  warn.mockRestore();
});

test('a photodump picture joins its character once, and comes back in the Studio with its scene', async () => {
  const job = await portrait('c-portrait-3');
  const character = (await (await save({ name: 'Nova', type: 'bold', description: 'short silver hair', imageRef: job.outputImageRef })).json()) as CharacterSummary;
  const where = scenePhrase('cafe');
  const scene = photodumpScene(character.description, where);
  const edit = await postEdits(request({ imageRef: character.imageRef, instruction: photodumpInstruction(where), scene }, 'c-edit-1'));
  expect(edit.status).toBe(201);
  const done = await poll(((await edit.json()) as JobSummary).id);
  expect(done.state).toBe('succeeded');

  const add = () => postPhoto(request({ imageRef: done.outputImageRef, scene, jobId: done.id }), params({ id: character.id }));
  const first = (await (await add()).json()) as CharacterSummary;
  expect(first.photos).toEqual([
    { imageRef: done.outputImageRef, url: `/media/data/${done.outputImageRef}`, scene, historyKey: `job:${done.id}`, createdAt: expect.any(String) },
  ]);
  expect(((await (await add()).json()) as CharacterSummary).photos).toHaveLength(1);

  const items = (await (await getHistory()).json()) as HistoryItem[];
  expect(items.find((item) => item.key === `job:${done.id}`)?.reprise).toMatchObject({ tab: 'camera', imageRef: done.outputImageRef, prompt: scene });
});

test('a photo for an unknown character answers 404; a deleted character is gone', async () => {
  const job = await portrait('c-portrait-4');
  const missing = await postPhoto(request({ imageRef: job.outputImageRef, scene: 'x' }), params({ id: '00000000-0000-0000-0000-000000000000' }));
  expect(missing.status).toBe(404);
  const character = (await (await save({ name: 'Gone', type: 'cartoon', description: 'a round robot', imageRef: job.outputImageRef })).json()) as CharacterSummary;
  expect((await deleteCharacter(new Request('http://localhost/x'), params({ id: character.id }))).status).toBe(204);
  expect((await getCharacter(new Request('http://localhost/x'), params({ id: character.id }))).status).toBe(404);
  expect((await getCharacter(new Request('http://localhost/x'), params({ id: '../etc' }))).status).toBe(404);
});

test('the portrait text is a plain full-body shot; a cartoon is not asked to be photorealistic', () => {
  expect(characterPrompt('everyday', '  a tall man, green coat  ')).toMatch(/^Full-body portrait of a fictional character, an everyday person with a natural look: a tall man, green coat\. .*photorealistic/);
  expect(characterPrompt('cartoon', 'a round robot')).not.toMatch(/photorealistic/);
  expect(characterPrompt('extreme', 'x'.repeat(240)).length).toBeLessThanOrEqual(500);
});

test('the pictures of a photodump that finish together are all kept', async () => {
  const job = await portrait('c-portrait-5');
  const character = (await (await save({ name: 'Many', type: 'everyday', description: 'a tall man, green coat', imageRef: job.outputImageRef })).json()) as CharacterSummary;
  const edits = await Promise.all(
    ['cafe', 'beach', 'street', 'mountain', 'kitchen', 'rooftop'].map(async (scene, index) => {
      const res = await postEdits(request({ imageRef: character.imageRef, instruction: photodumpInstruction(scene) }, `c-many-${index}`));
      return poll(((await res.json()) as JobSummary).id);
    }),
  );
  await Promise.all(edits.map((done) => postPhoto(request({ imageRef: done.outputImageRef, scene: 'x', jobId: done.id }), params({ id: character.id }))));
  const after = (await (await getCharacter(new Request('http://localhost/x'), params({ id: character.id }))).json()) as CharacterSummary;
  expect(after.photos).toHaveLength(6);
});

test('a photodump picture is captioned with its place, read back from what it shows', () => {
  expect(placeOf(photodumpScene('a fox in a green hoodie', scenePhrase('cafe')))).toBe('cafe');
  expect(placeOf('a fox in a green hoodie, somewhere else')).toBeUndefined();
});
