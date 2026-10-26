import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST as postImport } from '@/app/api/community/import/route';
import { POST as postGenerations } from '@/app/api/generations/route';
import { POST as postMusic } from '@/app/api/sequences/[id]/music/route';
import { POST as postSequence } from '@/app/api/sequences/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { generationRequest, params, repoRoot, setupTempData } from './helpers';

// Every text typed in the app, and every text of a share file, meets registry/blocked-names.txt: 400 blocked-name.
const dataDir = setupTempData();
let extensions: string | undefined;
beforeEach(() => {
  extensions = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (extensions === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = extensions;
  vi.restoreAllMocks();
});

const json = (url: string, body: unknown, key?: string) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });
const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const crashPush = () => readFileSync(join(repoRoot, 'presets', 'crash-push.yaml'), 'utf8');

async function refused(response: Promise<Response>): Promise<void> {
  const res = await response;
  expect(await res.json()).toEqual({ error: 'blocked-name' });
  expect(res.status).toBe(400);
}

describe('a camera clip', () => {
  test.each([
    ['the description of the photo', { presetId: 'crash-push', userPrompt: 'Taylor Swift dancing on a pier' }],
    ['the negative prompt', { presetId: 'crash-push', negative: 'blurry, Barack Obama' }],
    ['the prompt of a remixed move', { presetYaml: crashPush().replace('dynamic camera push-in', 'Kamala Harris, dynamic camera push-in') }],
    ['the name of a remixed move', { presetYaml: crashPush().replace('name: Crash Push', 'name: Barack Obama Push') }],
  ])('%s', async (_what, body) => {
    await refused(postGenerations(generationRequest({ ...body, imageRef: await sampleRef() }, `blocked-${_what}`)));
  });
});

test('a film: the description of any of its shots, before the first render', async () => {
  const shots = [{ presetId: 'crash-push' }, { presetId: 'pan-left', userPrompt: 'Taylor Swift waves at the camera' }];
  await refused(postSequence(json('/api/sequences', { imageRef: await sampleRef(), shots }, 'blocked-film')));
});

test("the music of a film: its prompt", async () => {
  const id = '00000000-0000-4000-8000-0000000000b1';
  const dir = join(dataDir(), 'sequences', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'record.json'),
    JSON.stringify({ id, imageRef: 'uploads/x.png', aspect: '16:9', idempotencyKey: 'f', state: 'succeeded', shots: [], currentShot: 0, progress: 1, outputUrl: `/media/data/sequences/${id}/film.mp4`, createdAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z' }),
  );
  await refused(postMusic(json(`/api/sequences/${id}/music`, { prompt: 'a pop song sung by Taylor Swift' }, 'blocked-music'), params({ id })));
});

describe('a share file someone sent', () => {
  const shareFile = (overrides: Record<string, unknown>) => ({
    schema: 'montagio/share@0.1',
    title: 'Harbour film',
    kind: 'film',
    task: 'film',
    name: 'Film',
    reprise: { tab: 'film', presetId: 'crash-push' },
    createdAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  });

  test('the name it shows in the gallery', async () => {
    await refused(postImport(json('/api/community/import', shareFile({ name: 'Taylor Swift' }))));
  });

  test("the description of a film's shot", async () => {
    const reprise = { tab: 'film', shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left', prompt: 'Barack Obama on the quay' }] };
    await refused(postImport(json('/api/community/import', shareFile({ reprise }))));
  });

  test('the text of a remixed move', async () => {
    const presetYaml = crashPush().replace('dynamic camera push-in', 'Kamala Harris, dynamic camera push-in');
    await refused(postImport(json('/api/community/import', shareFile({ kind: 'clip', task: 'camera', reprise: { tab: 'camera', presetId: 'crash-push' }, presetYaml }))));
  });
});
