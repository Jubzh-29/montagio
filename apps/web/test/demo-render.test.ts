import { join } from 'node:path';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { demoExampleModel, demoKindOf, demoRender } from '@/server/demo-render';
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
  // a 20-step render, whatever model the preset now starts on
  expect(demoExampleModel(out)).toBe('wan22-i2v-a14b-fun-camera');
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

test('the avatar of the sample portrait, and the motion of the sample character on the sample dance, are their GPU renders', async () => {
  const sampleFor = async (tab: string) =>
    ((await (await postSampleUpload(new Request(`http://localhost/api/uploads/sample?for=${tab}`, { method: 'POST' }))).json()) as { imageRef: string }).imageRef;
  const portrait = photoFile(await sampleFor('avatar'));
  const character = photoFile(await sampleFor('motion'));
  const voice = { node: '2', field: 'audio', path: join(repoRoot, 'demo-assets', 'audio', '_default.flac') };
  expect(await render({ presetId: 'avatar', output: 'video', files: [...files(portrait), voice] })).toBe(join(repoRoot, 'demo-assets', 'examples', 'avatar.mp4'));
  const dance = { node: '2', field: 'video', path: join(repoRoot, 'demo-assets', 'videos', 'sample-dance.mp4') };
  expect(await render({ presetId: 'motion', output: 'video', files: [...files(character), dance] })).toBe(join(repoRoot, 'demo-assets', 'examples', 'motion.mp4'));
  // Another dance: the example would show the wrong one, so the photo is moved instead.
  const other = { node: '2', field: 'video', path: join(repoRoot, 'demo-assets', 'clips', '_default.mp4') };
  expect(demoKindOf(await render({ presetId: 'motion', output: 'video', files: [...files(character), other] }))).toBe('moved');
}, 60_000);

test("a clip moved from the user's photo keeps its demo mention and carries its recipe", async () => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
  resetServicesForTests();
  const { imageRef } = await ownPhoto();
  const { id } = (await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'moved-recipe'))).json()) as { id: string };
  let record: { state: string; outputUrl?: string } = { state: 'queued' };
  for (let i = 0; i < 100 && record.state !== 'succeeded'; i++) {
    record = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
    if (record.state !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(record.state).toBe('succeeded');
  const tags = await readTags(mediaFileFor(record.outputUrl)!);
  expect(tags.comment).toBe('Montagio demo render');
  expect(JSON.parse(tags.synopsis!)).toMatchObject({ compact: true, backend: 'demo', task: 'camera' });
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
  // Crash Push starts on the Turbo; its example was rendered in 20 steps, the model its caption names.
  expect(rec).toMatchObject({ modelId: 'wan22-i2v-a14b-fun-camera-turbo', demoModelId: 'wan22-i2v-a14b-fun-camera' });
}, 30_000);
