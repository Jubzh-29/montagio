import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as cancelGeneration } from '@/app/api/generations/[id]/cancel/route';
import { GET as getModels } from '@/app/api/models/route';
import { GET as getOpenStack } from '@/app/api/open-stack/route';
import { GET as getPresets } from '@/app/api/presets/route';
import { GET as getPresetYaml } from '@/app/api/presets/[id]/yaml/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { GET as getWorkflow } from '@/app/api/workflows/[id]/route';
import { GET as getMedia } from '@/app/media/[...path]/route';
import { galleryOrder, presetPreviewUrl } from '@/server/gallery';
import { failureResponse, mediaFileFor } from '@/server/generations';
import { resetServicesForTests } from '@/server/services';
import { MAX_UPLOAD_FORM_BYTES, readUploadMeta, saveUploadFromFile } from '@/server/uploads';
import { loadLibrary } from '@montagio/presets';
import { readTags, tagClip } from '@montagio/sequence';
import {
  bigPng,
  generationRequest,
  jpegWithOrientation,
  params,
  pngFile,
  seedRecordFile,
  uploadRequest,
  setupTempData,
} from './helpers';

// The real tagClip, watched: the tests count how many times a clip gets tagged.
vi.mock('@montagio/sequence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@montagio/sequence')>();
  return { ...actual, tagClip: vi.fn(actual.tagClip) };
});

const dataDir = setupTempData();

async function uploadedImageRef(): Promise<string> {
  const res = await postUpload(uploadRequest(pngFile(1920, 1080)));
  return ((await res.json()) as { imageRef: string }).imageRef;
}

/** A generation whose demo render is already finished, not polled yet. */
async function finishedGeneration(key: string): Promise<string> {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  const imageRef = await uploadedImageRef();
  return ((await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, key))).json()) as { id: string }).id;
}

const poll = async (id: string) => (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();

describe('uploads', () => {
  test('11 MB is refused with 413', async () => {
    expect((await postUpload(uploadRequest(bigPng(11 * 1024 * 1024)))).status).toBe(413);
  });

  test('a body past 10 MB: 413 at the limit, the rest never read', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 30 * chunk.byteLength) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const init = { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body, duplex: 'half' };
    const res = await postUpload(new Request('http://localhost/api/uploads', init as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(MAX_UPLOAD_FORM_BYTES + 2 * chunk.byteLength);
  });

  test('text/plain is refused with 415', async () => {
    expect((await postUpload(uploadRequest(new File(['x'], 'a.txt', { type: 'text/plain' })))).status).toBe(415);
  });

  test('accented name with spaces is stored under a generated name', async () => {
    const res = await postUpload(uploadRequest(pngFile(1920, 1080, 'été photo.png')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      imageRef: expect.stringMatching(/^uploads\/[0-9a-f-]{36}\.png$/),
      width: 1920,
      height: 1080,
      aspect: '16:9',
      origin: 'upload',
      personal: true,
    });
  });

  test('a panorama maps to 16:9 and a tall strip to 9:16', async () => {
    const wide = await (await postUpload(uploadRequest(pngFile(4000, 500)))).json();
    const tall = await (await postUpload(uploadRequest(pngFile(500, 4000)))).json();
    expect([wide.aspect, tall.aspect]).toEqual(['16:9', '9:16']);
  });

  test('a rotated phone photo (EXIF orientation 6) is measured upright', async () => {
    const res = await postUpload(uploadRequest(jpegWithOrientation(6000, 4000, 6)));
    expect(await res.json()).toMatchObject({ width: 4000, height: 6000, aspect: '9:16' });
  });

  test('an unrotated landscape JPEG keeps its size', async () => {
    const res = await postUpload(uploadRequest(jpegWithOrientation(4032, 3024, 1)));
    expect(await res.json()).toMatchObject({ width: 4032, height: 3024, aspect: '1:1' });
  });

  test('an imported photo is personal', async () => {
    expect(await (await postUpload(uploadRequest(pngFile(1280, 720)))).json()).toMatchObject({ origin: 'upload', personal: true });
  });

  test('the sample route gives a sample photo that is not personal', async () => {
    const res = await postSampleUpload();
    expect(res.status).toBe(201);
    const result = (await res.json()) as { imageRef: string };
    expect(result).toMatchObject({ imageRef: expect.stringMatching(/^uploads\/[0-9a-f-]{36}\.png$/), aspect: '16:9', origin: 'sample', personal: false });
    expect(await readUploadMeta(result.imageRef)).toMatchObject({ origin: 'sample', personal: false });
  });

  test('an upload written before origins existed reads as personal', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    mkdirSync(join(dataDir(), 'uploads'), { recursive: true });
    writeFileSync(join(dataDir(), 'uploads', `${id}.json`), JSON.stringify({ imageRef: `uploads/${id}.png`, width: 4, height: 3, aspect: '1:1' }));
    expect(await readUploadMeta(`uploads/${id}.png`)).toMatchObject({ origin: 'upload', personal: true });
  });

  test('a frame of a sequence is not personal', async () => {
    const frame = join(dataDir(), 'frame.png');
    writeFileSync(frame, Buffer.from(await pngFile(832, 480).arrayBuffer()));
    expect(await saveUploadFromFile(frame)).toMatchObject({ origin: 'frame', personal: false });
  });

  test('a PNG-typed file that is not an image is refused with 415', async () => {
    expect((await postUpload(uploadRequest(new File(['not a png'], 'x.png', { type: 'image/png' })))).status).toBe(415);
  });
});

describe('generations', () => {
  test('missing Idempotency-Key -> 400', async () => {
    const res = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef: 'uploads/x.png' }, null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing-idempotency-key' });
  });

  test('unknown preset -> 400 unknown-preset', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetId: 'nope', imageRef }, 'k1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-preset' });
  });

  test('unknown image -> 400 unknown-image', async () => {
    const res = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef: 'uploads/missing.png' }, 'k2'));
    expect(await res.json()).toEqual({ error: 'unknown-image' });
  });

  test('image model for a video preset -> 400 model-incompatible', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetId: 'crash-push', modelId: 'z-image-turbo', imageRef }, 'k3'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'model-incompatible' });
  });

  test('valid request -> 201 with a queued record using the preferred model', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'k4'));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      presetId: 'crash-push',
      modelId: 'wan22-i2v-a14b-fun-camera',
      aspect: '16:9',
      state: 'queued',
      backendKind: 'demo',
    });
  });

  test('same key twice -> same id (201 then 200)', async () => {
    const imageRef = await uploadedImageRef();
    const a = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'dup'));
    const b = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'dup'));
    expect([a.status, b.status]).toEqual([201, 200]);
    expect((await b.json()).id).toBe((await a.json()).id);
  });

  test('two concurrent requests with the same key create a single generation', async () => {
    const imageRef = await uploadedImageRef();
    const [a, b] = await Promise.all([
      postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'race')),
      postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'race')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect((await a.json()).id).toBe((await b.json()).id);
  });

  test('GET reflects backend progress, then 404 for an unknown id', async () => {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'k5'))).json();
    const res = await getGeneration(new Request(`http://localhost/api/generations/${id}`), params({ id }));
    expect(await res.json()).toMatchObject({ id, state: 'running' });
    const missing = await getGeneration(new Request('http://localhost/api/generations/x'), params({ id: 'x' }));
    expect(missing.status).toBe(404);
  });

  test('a finished clip is a tagged copy under data/', async () => {
    process.env.MONTAGIO_DEMO_DURATION_MS = '0';
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'k6'))).json();
    const rec = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
    expect(rec).toMatchObject({ state: 'succeeded', progress: 1, outputUrl: `/media/data/generations/${id}/clip.mp4` });
    expect(await readTags(mediaFileFor(rec.outputUrl)!)).toMatchObject({ comment: 'AI-generated' });
  }, 30_000);

  test('a clip.mp4 already on disk (tagged before a restart) is delivered as is', async () => {
    const id = await finishedGeneration('reuse');
    const clip = join(dataDir(), 'generations', id, 'clip.mp4');
    writeFileSync(clip, 'tagged before the restart');
    vi.mocked(tagClip).mockClear();
    expect(await poll(id)).toMatchObject({ state: 'succeeded', outputUrl: `/media/data/generations/${id}/clip.mp4` });
    expect(readFileSync(clip, 'utf8')).toBe('tagged before the restart');
    expect(tagClip).not.toHaveBeenCalled();
  });

  test('a clip.mp4 removed after delivery is tagged again on the next delivery', async () => {
    const id = await finishedGeneration('retag');
    const dir = join(dataDir(), 'generations', id);
    const delivered = await poll(id);
    // The record still says running, as if its save after the first delivery was lost: the next poll delivers again.
    seedRecordFile(dataDir(), { ...delivered, state: 'running', progress: 0, outputUrl: undefined });
    rmSync(join(dir, 'clip.mp4'));
    vi.mocked(tagClip).mockClear();
    expect(await poll(id)).toMatchObject({ state: 'succeeded', outputUrl: `/media/data/generations/${id}/clip.mp4` });
    expect(tagClip).toHaveBeenCalledTimes(1);
    expect(await readTags(join(dir, 'clip.mp4'))).toMatchObject({ comment: 'AI-generated' });
  }, 30_000);

  test('concurrent polls of a finished render tag its clip once', async () => {
    const id = await finishedGeneration('concurrent');
    vi.mocked(tagClip).mockClear();
    const records = await Promise.all([poll(id), poll(id), poll(id)]);
    expect(records.map((rec) => rec.outputUrl)).toEqual(Array(3).fill(`/media/data/generations/${id}/clip.mp4`));
    expect(tagClip).toHaveBeenCalledTimes(1);
    expect(await readTags(join(dataDir(), 'generations', id, 'clip.mp4'))).toMatchObject({ comment: 'AI-generated' });
  }, 30_000);

  test('a missing FFmpeg is refused before any render, and the server log says why', async () => {
    process.env.MONTAGIO_FFMPEG = 'ffmpeg-does-not-exist';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const imageRef = await uploadedImageRef();
      const res = await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'noff'));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'ffmpeg-missing' });
      expect(existsSync(join(dataDir(), 'generations'))).toBe(false);
      expect(logged.mock.calls.flat().map(String).join(' ')).toMatch(/MONTAGIO_FFMPEG/);
    } finally {
      logged.mockRestore();
      delete process.env.MONTAGIO_FFMPEG;
    }
  });

  test('a backend error from another copy of the adapter still gets its status', async () => {
    const foreign = Object.assign(new Error('x'), {
      name: 'BackendError',
      code: 'workflow-rejected',
      retryable: false,
      [Symbol.for('montagio.BackendError')]: true,
    });
    const res = failureResponse(foreign);
    expect([res?.status, await res?.json()]).toEqual([422, { error: 'workflow-rejected' }]);
  });

  test('a clip FFmpeg cannot read is delivered untagged instead of failing', async () => {
    process.env.MONTAGIO_DEMO_DURATION_MS = '0';
    const clips = join(dataDir(), 'demo-clips');
    mkdirSync(clips, { recursive: true });
    writeFileSync(join(clips, '_default.mp4'), 'not a video at all');
    process.env.MONTAGIO_DEMO_CLIPS = clips;
    resetServicesForTests();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const imageRef = await uploadedImageRef();
      const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'garbage'))).json();
      const rec = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
      expect(rec).toMatchObject({ state: 'succeeded', outputUrl: expect.stringMatching(/demo-clips\/_default\.mp4$/) });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      delete process.env.MONTAGIO_DEMO_CLIPS;
    }
  }, 30_000);

  test('cancel moves a running job to canceled', async () => {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'k7'))).json();
    const res = await cancelGeneration(new Request('http://localhost/x', { method: 'POST' }), params({ id }));
    expect(await res.json()).toMatchObject({ id, state: 'canceled' });
  });

  test('a generation lost by the backend becomes failed/lost', async () => {
    seedRecordFile(dataDir(), {
      id: 'lost-1',
      presetId: 'crash-push',
      modelId: 'wan22-i2v-a14b-fun-camera',
      imageRef: 'uploads/x.png',
      seed: 1,
      aspect: '16:9',
      state: 'running',
      progress: 0.4,
      backendKind: 'demo',
      backendJobId: 'demo-000000000000',
      idempotencyKey: 'old',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
    });
    const res = await getGeneration(new Request('http://localhost/x'), params({ id: 'lost-1' }));
    expect(await res.json()).toMatchObject({ state: 'failed', error: 'lost' });
  });
});

describe('downloads and catalog', () => {
  test('workflow download contains the compiled camera pose', async () => {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'wf'))).json();
    const res = await getWorkflow(new Request('http://localhost/x'), params({ id }));
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="montagio-crash-push-.+\.json"/);
    expect(JSON.stringify(await res.json())).toContain('Zoom In');
  });

  test('presets list exposes ids, names and poses', async () => {
    const list = await (await getPresets()).json();
    expect(list).toContainEqual(
      expect.objectContaining({ id: 'crash-push', name: 'Crash Push', poses: ['zoom_in'], defaultModel: 'wan22-i2v-a14b-fun-camera' }),
    );
  });

  test('presets come in gallery order: the families of spec §6, Crash Push first', async () => {
    const list = (await (await getPresets()).json()) as { id: string }[];
    expect(list.map((preset) => preset.id)).toEqual([
      'crash-push', 'slow-push', 'pull-back-reveal', 'pan-left', 'pan-right', 'crane-up',
      'rise-and-push', 'drift-left-push', 'pull-back-tilt-up', 'push-and-settle', 'breathing',
    ]);
  });

  test('the presets list has a previewUrl exactly for the presets whose preview file exists', async () => {
    // True today (no preview yet) and after GPU session S3 commits presets/previews/*.mp4.
    const root = process.env.MONTAGIO_ROOT!;
    const lib = await loadLibrary(root);
    const list = (await (await getPresets()).json()) as { id: string; previewUrl?: string }[];
    for (const item of list) {
      const preview = lib.presets.get(item.id)!.preview;
      const expected = existsSync(join(root, 'presets', ...preview.split('/'))) ? `/media/presets/${preview}` : undefined;
      expect(item.previewUrl, item.id).toBe(expected);
    }
  });

  test('previewUrl points at the preview only when its file exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'montagio-previews-'));
    mkdirSync(join(root, 'presets', 'previews'), { recursive: true });
    writeFileSync(join(root, 'presets', 'previews', 'here.mp4'), 'x');
    expect(await presetPreviewUrl(root, 'previews/here.mp4')).toBe('/media/presets/previews/here.mp4');
    expect(await presetPreviewUrl(root, 'previews/missing.mp4')).toBeUndefined();
  });

  test('presets missing from the gallery order follow, by id', () => {
    expect(galleryOrder([{ id: 'zeta' }, { id: 'breathing' }, { id: 'alpha' }, { id: 'crash-push' }]).map((p) => p.id)).toEqual([
      'crash-push', 'breathing', 'alpha', 'zeta',
    ]);
  });

  test('preset YAML downloads as an attachment', async () => {
    const res = await getPresetYaml(new Request('http://localhost/x'), params({ id: 'crash-push' }));
    expect(res.headers.get('content-disposition')).toContain('montagio-preset-crash-push.yaml');
    expect(await res.text()).toContain('id: crash-push');
    expect((await getPresetYaml(new Request('http://localhost/x'), params({ id: '../package' }))).status).toBe(404);
  });

  test('models list exposes licenses', async () => {
    const list = await (await getModels()).json();
    expect(list.map((m: { license: string }) => m.license)).toEqual(['Apache-2.0', 'Apache-2.0', 'Apache-2.0', 'Apache-2.0']);
    expect(list.map((m: { tier: string }) => m.tier)).toEqual(['quality', 'turbo', 'fast', 'fast']);
  });

  test('open-stack report is ok for the repository', async () => {
    expect(await (await getOpenStack()).json()).toMatchObject({ ok: true });
  });
});

describe('media', () => {
  const media = (path: string[], headers: Record<string, string> = {}) =>
    getMedia(new Request('http://localhost/media/x', { headers }), params({ path }));

  test('serves a demo clip with its content type', async () => {
    const res = await media(['demo-assets', 'clips', 'crash-push.mp4']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  test('supports byte ranges for video players', async () => {
    const res = await media(['demo-assets', 'clips', 'crash-push.mp4'], { range: 'bytes=0-99' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  test('path traversal is refused', async () => {
    expect((await media(['..', '..', 'package.json'])).status).toBe(400);
    expect((await media(['data', '..', '..', 'package.json'])).status).toBe(400);
  });

  test('a decoded UNC or absolute segment is refused (Windows admin share)', async () => {
    expect((await media(['data', '//localhost/C$/Windows/win.ini'])).status).toBe(400);
    expect((await media(['demo-assets', '/etc/hosts'])).status).toBe(400);
    expect((await media(['data', ''])).status).toBe(400);
    expect((await media(['data', '.', 'x.png'])).status).toBe(400);
  });

  test('only data/ and demo-assets/ are served', async () => {
    expect((await media(['presets', 'crash-push.yaml'])).status).toBe(400);
  });
});
