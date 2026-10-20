import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probe, probeAudio, readTags } from '@montagio/sequence';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postMusic } from '@/app/api/sequences/[id]/music/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { readJobWorkflow } from '@/server/jobs';
import { readSequence } from '@/server/sequences';
import { params, setupTempData } from './helpers';

const dataDir = setupTempData();
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

/** A film as a finished sequence leaves it: 5 s of silent 832x480 video at 16 fps, and its record. */
function seedFilm(id: string, state = 'succeeded'): void {
  const dir = join(dataDir(), 'sequences', id);
  mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=832x480:rate=16', '-frames:v', '80', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'film.mp4')]);
  const record = {
    id,
    imageRef: 'uploads/00000000-0000-4000-8000-000000000001.png',
    aspect: '16:9',
    idempotencyKey: `film-${id}`,
    state,
    shots: [
      { presetId: 'crash-push', state: 'succeeded' },
      { presetId: 'pan-left', state: 'succeeded' },
    ],
    currentShot: 1,
    progress: 1,
    ...(state === 'succeeded' ? { outputUrl: `/media/data/sequences/${id}/film.mp4` } : {}),
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record));
}

const post = (id: string, body: unknown, key: string) =>
  postMusic(
    new Request(`http://localhost/api/sequences/${id}/music`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    params({ id }),
  );

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('music did not settle');
}

const FILM = '00000000-0000-4000-8000-0000000000f1';

test('music under a finished film: a film with sound and its 9:16 cut, both tagged', async () => {
  seedFilm(FILM);
  const res = await post(FILM, { prompt: 'tense synth pulse' }, 'mu1');
  expect(res.status).toBe(201);
  const done = await poll(((await res.json()) as JobSummary).id);
  expect(done).toMatchObject({ state: 'succeeded', task: 'music' });
  for (const url of [done.outputUrl, done.verticalUrl]) {
    const file = mediaFileFor(url)!;
    expect(await probeAudio(file)).not.toBeNull();
    expect((await readTags(file)).comment).toBe('AI-generated');
  }
  expect(await probe(mediaFileFor(done.verticalUrl)!)).toMatchObject({ width: 720, height: 1280 });
}, 60_000);

test("the film's length sets the music's", async () => {
  seedFilm(FILM);
  const { id } = (await (await post(FILM, { prompt: 'warm piano', bpm: 120 }, 'mu2')).json()) as JobSummary;
  const { workflow } = (await readJobWorkflow(id))!;
  // A 5 s film gets the model's 10 s at least; the montage cuts the music to the film.
  expect(workflow['98']!.inputs.seconds).toBe(10);
  expect(workflow['94']!.inputs.bpm).toBe(120);
});

test('music on a film still assembling: 400 invalid-input', async () => {
  seedFilm(FILM, 'assembling');
  const res = await post(FILM, { prompt: 'tense synth pulse' }, 'mu3');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid-input' });
});

test('two musics on one film are two jobs; the sequence keeps the last, the first stays in the history', async () => {
  seedFilm(FILM);
  const first = await poll(((await (await post(FILM, { prompt: 'tense synth pulse' }, 'mu4a')).json()) as JobSummary).id);
  const second = await poll(((await (await post(FILM, { prompt: 'warm piano' }, 'mu4b')).json()) as JobSummary).id);
  expect(first.id).not.toBe(second.id);
  expect((await readSequence(FILM))!.music).toEqual({ jobId: second.id });
  const keys = (await listHistory()).map((item) => item.key);
  expect(keys).toEqual(expect.arrayContaining([`job:${first.id}`, `job:${second.id}`, `sequence:${FILM}`]));
  const music = (await listHistory()).find((item) => item.key === `job:${first.id}`)!;
  expect(music).toMatchObject({ kind: 'film', task: 'music', reprise: { tab: 'film' } });
  expect(mediaFileFor(first.outputUrl)).not.toBe(mediaFileFor(second.outputUrl));
}, 60_000);

test('bpm 400: 400 invalid-input', async () => {
  seedFilm(FILM);
  const res = await post(FILM, { prompt: 'tense synth pulse', bpm: 400 }, 'mu5');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid-input' });
});

test('music hidden: 404 extension-disabled', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  seedFilm(FILM);
  const res = await post(FILM, { prompt: 'tense synth pulse' }, 'mu6');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});
