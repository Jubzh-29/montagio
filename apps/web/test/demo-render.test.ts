import { join } from 'node:path';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { demoKindOf, demoRender } from '@/server/demo-render';
import { mediaFileFor } from '@/server/generations';
import { resetServicesForTests } from '@/server/services';
import { saveUploadFromFile } from '@/server/uploads';
import { loadLibrary } from '@montagio/presets';
import { probe, readTags } from '@montagio/sequence';
import { generationRequest, params, repoRoot, setupTempData } from './helpers';

const dataDir = setupTempData();

beforeEach(() => {
  // On for this file: the other web tests keep the pre-rendered files.
  delete process.env.MONTAGIO_DEMO_RENDER;
  resetServicesForTests();
});

const photoFile = (ref: string) => join(dataDir(), ...ref.split('/'));
/** A photo that is no sample: the gradient of demo-assets, imported as the user's own. */
const ownPhoto = () => saveUploadFromFile(join(repoRoot, 'demo-assets', 'images', '_default.png'), { origin: 'upload', personal: true });
const sample = async () => (await (await postSampleUpload()).json()) as { imageRef: string };
const render = demoRender(loadLibrary(repoRoot));
const files = (path: string) => [{ node: '1', field: 'image', path }];

test('the sample photo of a preset the GPU session rendered gets that render', async () => {
  const { imageRef } = await sample();
  const out = await render({ presetId: 'crash-push', output: 'video', files: files(photoFile(imageRef)) });
  expect(out).toBe(join(repoRoot, 'presets', 'previews', 'crash-push.mp4'));
  expect(demoKindOf(out)).toBe('example');
});

test('any other photo is moved by FFmpeg along the preset, once, and says no model made it', async () => {
  const { imageRef } = await ownPhoto();
  const out = await render({ presetId: 'crash-push', output: 'video', files: files(photoFile(imageRef)) });
  expect(out).toMatch(/[\\/]demo-renders[\\/][0-9a-f]{16}-crash-push\.mp4$/);
  expect(demoKindOf(out)).toBe('moved');
  const info = await probe(out!);
  expect([info.width, info.height]).toEqual([832, 480]);
  expect(await readTags(out!)).toMatchObject({ comment: 'Montagio demo render' });
  // The same photo and preset again: the clip on disk.
  expect(await render({ presetId: 'crash-push', output: 'video', files: files(photoFile(imageRef)) })).toBe(out);
}, 60_000);

test('the sample of another tab, or an effect without a render of it, is moved too', async () => {
  const { imageRef } = await sample();
  const out = await render({ presetId: 'squish', output: 'video', files: files(photoFile(imageRef)) });
  expect(demoKindOf(out)).toBe('moved');
}, 60_000);

test('nothing for a job without a photo or that makes no video', async () => {
  const { imageRef } = await sample();
  expect(await render({ presetId: 'crash-push', output: 'image', files: files(photoFile(imageRef)) })).toBeUndefined();
  expect(await render({ presetId: 'motion', output: 'video', files: [{ node: '1', field: 'video', path: '/x/clip.mp4' }] })).toBeUndefined();
  expect(demoKindOf(join(repoRoot, 'demo-assets', 'clips', '_default.mp4'))).toBeUndefined();
  expect(demoKindOf(undefined)).toBeUndefined();
});

test('a camera move on the sample photo ends as the GPU render, tagged, with what it is', async () => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  const { imageRef } = await sample();
  const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'demo-example'))).json();
  let rec = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
  for (let i = 0; i < 50 && rec.state !== 'succeeded'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    rec = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
  }
  expect(rec).toMatchObject({ state: 'succeeded', demo: 'example', outputUrl: `/media/data/generations/${id}/clip.mp4` });
  expect(await readTags(mediaFileFor(rec.outputUrl)!)).toMatchObject({ comment: 'AI-generated' });
}, 30_000);
