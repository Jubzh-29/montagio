import { POST as postAvatars } from '@/app/api/avatars/route';
import { POST as postExport } from '@/app/api/captions/[id]/export/route';
import { GET as getExport } from '@/app/api/captions/[id]/export/[exportId]/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postCaptions } from '@/app/api/jobs/[id]/captions/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { CaptionExportSummary, JobSummary } from '@/lib/api-types';
import { params, setupTempData } from './helpers';

/** What the job pointed to at the moment each export wrote its final state: what a client polling it would find. */
const seen: { url: string | undefined; jobOutputUrl: string | undefined }[] = [];

vi.mock('@/server/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/store')>();
  return {
    ...actual,
    writeAtomic: vi.fn(async (path: string, content: string) => {
      const exportState = /[\\/]jobs[\\/]([^\\/]+)[\\/]exports[\\/][^\\/]+[\\/]state\.json$/.exec(path);
      const state = exportState ? (JSON.parse(content) as CaptionExportSummary) : null;
      if (exportState && state?.state === 'succeeded') {
        const { jobs } = await import('@/server/jobs');
        seen.push({ url: state.url, jobOutputUrl: (await jobs.read(exportState[1]!))?.outputUrl });
      }
      return actual.writeAtomic(path, content);
    }),
  };
});

setupTempData();
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved.MONTAGIO_EXTENSIONS = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (saved.MONTAGIO_EXTENSIONS === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = saved.MONTAGIO_EXTENSIONS;
});

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });

async function settle(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error(`job ${id} did not settle`);
}

async function finished(id: string, exportId: string): Promise<CaptionExportSummary> {
  for (let i = 0; i < 300; i++) {
    const state = (await (await getExport(new Request('http://localhost/x'), params({ id, exportId }))).json()) as CaptionExportSummary;
    if (state.state !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the export did not end');
}

test('an export says "succeeded" only once the job points to it, whatever the load', async () => {
  const imageRef = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
  const avatar = (await (await postAvatars(post('/api/avatars', { imageRef, text: 'Hello, this is a test of the Shot Rate avatar.', language: 'en' }))).json()) as JobSummary;
  expect((await settle(avatar.id)).state).toBe('succeeded');
  const captions = (await (await postCaptions(post(`/api/jobs/${avatar.id}/captions`, {}), params({ id: avatar.id }))).json()) as JobSummary;
  expect((await settle(captions.id)).state).toBe('succeeded');
  const id = captions.id;

  // Two exports one after the other: at the moment each writes "succeeded", the job already points to it.
  const first = (await (await postExport(post(`/api/captions/${id}/export`, { text: 'Hello, this is a test of the Montagio avatar.', style: 'pop' }), params({ id }))).json()) as CaptionExportSummary;
  const second = (await (await postExport(post(`/api/captions/${id}/export`, { text: 'Hello, this is a test of the Montagio avatar.', style: 'classic' }), params({ id }))).json()) as CaptionExportSummary;
  const [a, b] = [await finished(id, first.id), await finished(id, second.id)];
  expect([a.state, b.state]).toEqual(['succeeded', 'succeeded']);
  expect(seen).toEqual([
    { url: a.url, jobOutputUrl: a.url },
    { url: b.url, jobOutputUrl: b.url },
  ]);
}, 120_000);
