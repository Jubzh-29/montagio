import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, probeAudio, readTags } from '@montagio/sequence';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postMotion } from '@/app/api/motion/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postVideo } from '@/app/api/uploads/video/route';
import type { JobSummary } from '@/lib/api-types';
import { mediaFileFor } from '@/server/generations';
import { listHistory } from '@/server/history';
import { readJobWorkflow } from '@/server/jobs';
import { getServices } from '@/server/services';
import { videoPath } from '@/server/tasks/files';
import { MAX_VIDEO_FORM_BYTES } from '@/server/uploads';
import { params, setupTempData } from './helpers';

setupTempData();
let flag: string | undefined;
const scratch = mkdtempSync(join(tmpdir(), 'montagio-motion-'));
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  vi.restoreAllMocks();
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A reference clip as a phone films it: 832x480 at 25 fps, with sound. */
function clip(seconds: number, name: string): File {
  const path = join(scratch, name);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=832x480:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ]);
  return new File([readFileSync(path)], name, { type: 'video/mp4' });
}

const upload = (file: File) => {
  const form = new FormData();
  form.set('video', file);
  return postVideo(new Request('http://localhost/api/uploads/video', { method: 'POST', body: form }));
};

const post = (body: unknown, key: string) =>
  postMotion(
    new Request('http://localhost/api/motion', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
  );

async function poll(id: string): Promise<JobSummary> {
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as JobSummary;
    if (['succeeded', 'failed', 'canceled'].includes(job.state)) return job;
  }
  throw new Error('motion did not settle');
}

const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const videoRef = async () => ((await (await upload(clip(3, 'ref.mp4'))).json()) as { videoRef: string }).videoRef;

test('a reference video is kept for 5 s at 16 fps, silent, with its aspect', async () => {
  const res = await upload(clip(8, 'long.mp4'));
  expect(res.status).toBe(201);
  const meta = (await res.json()) as { videoRef: string; duration_s: number; sourceDuration_s: number; aspect: string; width: number; url: string };
  expect(meta).toMatchObject({ videoRef: expect.stringMatching(/^videos\/[0-9a-f-]{36}\.mp4$/), aspect: '16:9', width: 832 });
  expect(meta.duration_s).toBeCloseTo(5, 0);
  expect(meta.sourceDuration_s).toBeCloseTo(8, 0);
  const file = mediaFileFor(meta.url)!;
  expect(await probeAudio(file)).toBeNull();
  expect((await probe(file)).fps).toBe(16);
}, 60_000);

test('a video under 1 s or not a video: 400 invalid-input', async () => {
  const short = await upload(clip(0.5, 'short.mp4'));
  expect(short.status).toBe(400);
  expect(await short.json()).toEqual({ error: 'invalid-input' });
  const fake = await upload(new File([new Uint8Array([1, 2, 3, 4])], 'fake.mp4', { type: 'video/mp4' }));
  expect(fake.status).toBe(400);
  expect((await upload(new File(['x'], 'notes.txt', { type: 'text/plain' }))).status).toBe(415);
}, 60_000);

test('motion hidden: the video upload refuses before reading the file', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  const res = await upload(new File([new Uint8Array(8)], 'ref.mp4', { type: 'video/mp4' }));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
});

test('a body past 50 MB: 413 at the limit, the rest never read', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 80 * chunk.byteLength) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const init = { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body, duplex: 'half' };
  const res = await postVideo(new Request('http://localhost/api/uploads/video', init as RequestInit));
  expect(res.status).toBe(413);
  expect(sent).toBeLessThanOrEqual(MAX_VIDEO_FORM_BYTES + 2 * chunk.byteLength);
});

test('a motion transfer without rights: 400 rights-required', async () => {
  const res = await post({ imageRef: await sampleRef(), videoRef: await videoRef() }, 'mo1');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'rights-required' });
}, 60_000);

test("with rights: a tagged clip on the video's aspect", async () => {
  const res = await post({ imageRef: await sampleRef(), videoRef: await videoRef(), character: 'a knight in silver armour', rights: true }, 'mo2');
  expect(res.status).toBe(201);
  const created = (await res.json()) as JobSummary;
  expect(created).toMatchObject({ task: 'motion', modelId: 'wan-animate2-motion' });
  const { workflow } = (await readJobWorkflow(created.id))!;
  const model = (await getServices().library).extensionModels.get('wan-animate2-motion')!;
  const at = (key: 'width' | 'height') => {
    const binding = model.bindings[key];
    const target = Array.isArray(binding) ? binding[0]! : binding!;
    return workflow[target.node]!.inputs[target.field];
  };
  expect([at('width'), at('height')]).toEqual([832, 480]);
  const done = await poll(created.id);
  expect(done.state).toBe('succeeded');
  expect((await readTags(mediaFileFor(done.outputUrl)!)).comment).toBe('AI-generated');
}, 60_000);

test('motion hidden: 404 extension-disabled', async () => {
  const ref = await videoRef();
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  const res = await post({ imageRef: await sampleRef(), videoRef: ref, rights: true }, 'mo3');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'extension-disabled' });
}, 60_000);

test('a motion clip comes back on the motion tab', async () => {
  const imageRef = await sampleRef();
  const ref = await videoRef();
  const { id } = (await (await post({ imageRef, videoRef: ref, character: 'a knight', motion: 'waves', rights: true }, 'mo4')).json()) as JobSummary;
  await poll(id);
  const item = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(item).toMatchObject({ kind: 'clip', task: 'motion', reprise: { tab: 'motion', imageRef, videoRef: ref, prompt: 'a knight', motion: 'waves' } });
  // Its reference clip gone (its meta left behind), Reuse reopens the texts without it.
  rmSync(videoPath(ref));
  const again = (await listHistory()).find((entry) => entry.key === `job:${id}`);
  expect(again?.reprise).toMatchObject({ tab: 'motion', prompt: 'a knight', motion: 'waves' });
  expect(again?.reprise.videoRef).toBeUndefined();
}, 60_000);
