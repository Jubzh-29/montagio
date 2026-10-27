import { POST as postImport } from '@/app/api/community/import/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postGenerations } from '@/app/api/generations/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { GenerationRecord } from '@/server/store';
import { generationRequest, params, setupTempData } from './helpers';

setupTempData();
let extensions: string | undefined;
beforeEach(() => {
  extensions = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (extensions === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = extensions;
  vi.restoreAllMocks();
});

const json = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;

async function refused(response: Promise<Response>): Promise<void> {
  const res = await response;
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'blocked-term' });
}

test('a camera description with an explicit term is refused before a render starts', async () => {
  await refused(postGenerations(generationRequest({ presetId: 'crash-push', userPrompt: 'explicit sexual content', imageRef: await sampleRef() }, 'blocked-camera-term')));
});

test('an ordinary camera description containing a listed string inside a word still renders', async () => {
  const res = await postGenerations(generationRequest({ presetId: 'crash-push', userPrompt: 'a historic house in Sussex', imageRef: await sampleRef() }, 'ordinary-sussex'));
  expect(res.status).toBe(201);
  const created = (await res.json()) as GenerationRecord;
  let job = created;
  for (let i = 0; i < 20 && !['succeeded', 'failed', 'canceled'].includes(job.state); i++) {
    job = (await (await getGeneration(new Request('http://localhost/x'), params({ id: created.id }))).json()) as GenerationRecord;
  }
  expect(job.state).toBe('succeeded');
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

  test('an explicit term in its title is refused', async () => {
    await refused(postImport(json('/api/community/import', shareFile({ title: 'explicit sexual content' }))));
  });

  test("an explicit term in a film shot's description is refused", async () => {
    const reprise = { tab: 'film', shots: [{ presetId: 'crash-push' }, { presetId: 'pan-left', prompt: 'explicit sexual content' }] };
    await refused(postImport(json('/api/community/import', shareFile({ reprise }))));
  });
});
