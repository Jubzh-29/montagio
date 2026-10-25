import { GET as getExtensions } from '@/app/api/extensions/route';
import { POST as postGenerations } from '@/app/api/generations/route';
import { GET as getModels } from '@/app/api/models/route';
import { GET as getPresets } from '@/app/api/presets/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import type { ExtensionsInfo, ModelSummary, PresetSummary } from '@/lib/api-types';
import { resetRejectedForTests } from '@/server/extensions';
import { currentProfile } from '@/server/profile';
import { generationRequest, pngFile, setupTempData, uploadRequest } from './helpers';

setupTempData();

const saved = { profile: process.env.MONTAGIO_VRAM_PROFILE, extensions: process.env.MONTAGIO_EXTENSIONS };
beforeEach(() => {
  process.env.MONTAGIO_VRAM_PROFILE = '12gb';
  delete process.env.MONTAGIO_EXTENSIONS;
  resetRejectedForTests();
});
afterEach(() => {
  for (const [name, value] of [['MONTAGIO_VRAM_PROFILE', saved.profile], ['MONTAGIO_EXTENSIONS', saved.extensions]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('the 12 GB profile lists only the models a GPU held to 12 GB ran, with their times there', async () => {
  const models = (await (await getModels()).json()) as ModelSummary[];
  expect(models.map((model) => [model.id, model.tier, model.estimate_s['480p']])).toEqual([
    ['wan22-i2v-a14b-fun-camera-turbo', 'turbo', 145],
    ['wan22-ti2v-5b', 'fast', 193],
    ['z-image-turbo', 'fast', 12],
  ]);
});

test('a camera preset starts on the Turbo there, and the 20-step model is refused', async () => {
  const presets = (await (await getPresets()).json()) as PresetSummary[];
  expect(new Set(presets.map((preset) => preset.defaultModel))).toEqual(new Set(['wan22-i2v-a14b-fun-camera-turbo']));
  const imageRef = ((await (await postUpload(uploadRequest(pngFile(1920, 1080)))).json()) as { imageRef: string }).imageRef;
  const refused = await postGenerations(generationRequest({ presetId: 'crash-push', modelId: 'wan22-i2v-a14b-fun-camera', imageRef, userPrompt: 'a car' }, 'profile-1'));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: 'model-incompatible' });
});

test('the extensions run within 12 GB are the effects, at their time there', async () => {
  const info = (await (await getExtensions()).json()) as ExtensionsInfo;
  expect(info.extensions).toEqual(['effects']);
  expect(info.effects.length).toBeGreaterThan(0);
  expect(new Set(info.effects.map((effect) => effect.estimate_s))).toEqual(new Set([160]));
  expect(info.estimates).toEqual({ t2i: 15 });
});

test('an unknown profile reads as the 12 GB one, which offers less', () => {
  process.env.MONTAGIO_VRAM_PROFILE = '8gb';
  expect(currentProfile()).toBe('12gb');
  delete process.env.MONTAGIO_VRAM_PROFILE;
  expect(currentProfile()).toBe('standard');
});
