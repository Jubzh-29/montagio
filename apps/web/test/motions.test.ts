import { GET as getMotions } from '@/app/api/motions/route';
import { POST as pickMotion } from '@/app/api/uploads/video/library/route';
import type { LibraryMotionSummary } from '@/lib/api-types';
import { readVideoMeta } from '@/server/uploads';
import { setupTempData } from './helpers';

setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const pick = (id: unknown) =>
  pickMotion(new Request('http://localhost/api/uploads/video/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }));

test('the library lists its generated motions, each with its clip, its poster and its French name', async () => {
  const motions = (await (await getMotions()).json()) as LibraryMotionSummary[];
  expect(motions.map((motion) => motion.id)).toEqual(['hip-hop', 'hip-hop-30s', 'wave-clap', 'jumping-jacks', 'ballet-spin', 'shadow-boxing', 'robot-dance']);
  for (const motion of motions) {
    expect(motion.previewUrl).toBe(`/media/presets/motions/previews/${motion.id}.mp4`);
    expect(motion.posterUrl).toBe(`/media/presets/motions/previews/${motion.id}.jpg`);
    expect(motion.name_fr).toBeTruthy();
  }
});

test('a motion picked is kept as a sent clip would be: 16 fps, its length, ready for a motion or a restyle', async () => {
  const res = await pick('hip-hop-30s');
  expect(res.status).toBe(201);
  const meta = (await res.json()) as { videoRef: string; duration_s: number; url: string };
  expect(meta.duration_s).toBeGreaterThan(29.5);
  expect(meta.url).toMatch(/^\/media\/data\/uploads\/videos\//);
  expect(await readVideoMeta(meta.videoRef)).toMatchObject({ aspect: '9:16', width: 480, height: 832 });
}, 60_000);

test('an unknown motion is not found; without motion and restyle the library is empty and closed', async () => {
  expect((await pick('moonwalk')).status).toBe(404);
  expect((await pick('../secret')).status).toBe(404);
  process.env.MONTAGIO_EXTENSIONS = 'edit';
  expect(await (await getMotions()).json()).toEqual([]);
  expect((await pick('hip-hop')).status).toBe(404);
});
