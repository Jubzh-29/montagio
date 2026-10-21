import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getExtensions } from '@/app/api/extensions/route';
import { GET as getMedia } from '@/app/media/[...path]/route';
import type { ExtensionsInfo } from '@/lib/api-types';
import {
  estimateFor,
  markRejected,
  QUALITY_FACTOR,
  resetRejectedForTests,
  visibleEffects,
  visibleExtensions,
  visibleHooks,
} from '@/server/extensions';
import { presetPreviewUrl } from '@/server/gallery';
import { getServices, resetServicesForTests } from '@/server/services';
import { params, repoRoot, setupTempData, undateLibrary } from './helpers';

setupTempData();

let flag: string | undefined;
const roots: string[] = [];
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  delete process.env.MONTAGIO_EXTENSIONS;
  resetRejectedForTests();
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the repository's library under a temporary root, changed by `edit`, used by the server from now on. */
function libraryCopy(edit: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'montagio-ext-root-'));
  roots.push(root);
  for (const dir of ['presets', 'registry', 'workflows']) cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
  edit(root);
  process.env.MONTAGIO_ROOT = root;
  resetServicesForTests();
  return root;
}

/** Date a preset file, as a GPU session would. */
function datePreset(root: string, file: string): void {
  const path = join(root, 'presets', file);
  writeFileSync(path, `${readFileSync(path, 'utf8').trimEnd()}\ngpu_validated: 2026-10-22\n`);
}

/** Date extensions in registry/extensions.yaml. */
function dateExtensions(root: string, ...ids: string[]): void {
  const path = join(root, 'registry', 'extensions.yaml');
  let text = readFileSync(path, 'utf8');
  for (const id of ids) {
    const next = text.replace(new RegExp(`(- id: ${id}\\n(?:    .*\\n)*?    gpu_validated: )null`), '$12026-10-22');
    if (next === text) throw new Error(`extension ${id} not found`);
    text = next;
  }
  writeFileSync(path, text);
}

const info = async () => (await (await getExtensions()).json()) as ExtensionsInfo;

test('unset flag: nothing dated, nothing shown', async () => {
  libraryCopy(undateLibrary);
  expect(await visibleExtensions()).toEqual([]);
  expect(await visibleEffects()).toEqual([]);
  expect(await info()).toEqual({ extensions: [], effects: [], hooks: [], estimates: { t2i: 5 } });
});

test('unset flag: the dates of GPU sessions S2 and S3 show the seven extensions, the six effects, Wardrobe Swap and Ignite', async () => {
  expect(await visibleExtensions()).toEqual(['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion']);
  expect(await visibleEffects()).toHaveLength(6);
  // Iris Dive failed its transition in S2, Figurine barely changed the photo in S3: undated, so hidden.
  expect((await visibleHooks()).map((hook) => hook.id)).toEqual(['wardrobe-swap', 'ignite']);
});

test('all shows the seven extensions, every effect and every hook', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'all';
  expect(await visibleExtensions()).toEqual(['edit', 'effects', 'transitions', 'avatar', 'music', 'upscale', 'motion']);
  expect(await visibleEffects()).toHaveLength(6);
  expect(await visibleHooks()).toHaveLength(4);
});

test('a listed extension shows only its dated presets', async () => {
  libraryCopy((root) => {
    undateLibrary(root);
    datePreset(root, 'effects/squish.yaml');
  });
  process.env.MONTAGIO_EXTENSIONS = 'effects';
  expect((await visibleEffects()).map((effect) => effect.id)).toEqual(['squish']);
  expect(await visibleHooks()).toEqual([]);
});

test('by default, a dated extension shows its dated presets only', async () => {
  libraryCopy((root) => {
    undateLibrary(root);
    dateExtensions(root, 'effects');
    datePreset(root, 'effects/squish.yaml');
    datePreset(root, 'effects/explode.yaml');
  });
  expect(await visibleExtensions()).toEqual(['effects']);
  expect((await visibleEffects()).map((effect) => effect.id)).toEqual(['squish', 'explode']);
});

test('an invalid flag shows nothing and says why in the log', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.MONTAGIO_EXTENSIONS = 'transitions';
  expect(await visibleExtensions()).toEqual([]);
  expect(error.mock.calls.flat().join(' ')).toMatch(/MONTAGIO_EXTENSIONS/);
  error.mockRestore();
});

test('a rejected extension disappears until the process restarts, and so does one that requires it', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.MONTAGIO_EXTENSIONS = 'all';
  markRejected('edit', 'ComfyUI rejected the workflow');
  expect(await visibleExtensions()).toEqual(['effects', 'avatar', 'music', 'upscale', 'motion']);
  expect(await visibleHooks()).toEqual([]);
  resetRejectedForTests();
  expect(await visibleExtensions()).toContain('transitions');
  warn.mockRestore();
});

test('the full path costs QUALITY_FACTOR times the 4-step estimate', async () => {
  const model = (await getServices().library).extensionModels.get('wan21-i2v-effects')!;
  expect(QUALITY_FACTOR).toBe(5);
  expect(estimateFor(model, true)).toBe(model.estimate_s);
  expect(estimateFor(model, false)).toBe(model.estimate_s * 5);
});

test('GET /api/extensions describes the wall: effects first in their order, hooks, estimates', async () => {
  process.env.MONTAGIO_EXTENSIONS = 'all';
  const body = await info();
  expect(body.effects.map((effect) => effect.id)).toEqual(['squish', 'explode', 'cakeify', 'snap-zoom', 'frozen-moment', 'full-circle']);
  expect(body.hooks.map((hook) => hook.id)).toEqual(['iris-dive', 'wardrobe-swap', 'figurine', 'ignite']);
  expect(body.effects[0]).toEqual({
    id: 'squish',
    name: 'Squish',
    description: expect.any(String),
    estimate_s: expect.any(Number),
    subjectMax: expect.any(Number),
    // The caption links to its Open Stack line by this id.
    modelId: 'wan21-i2v-effects',
    modelName: expect.stringMatching(/Wan 2.1/),
    license: 'Apache-2.0',
    previewUrl: '/media/presets/effects/previews/squish.mp4',
  });
  expect(body.hooks.find((hook) => hook.id === 'wardrobe-swap')?.references).toBe(2);
  // A hook's clip is captioned with the transition model, as an effect's with the effects model.
  expect(body.hooks[0]).toMatchObject({ modelId: 'wan22-flf2v-transition', modelName: expect.stringMatching(/Wan 2.2/), license: 'Apache-2.0' });
  expect(body.estimates).toEqual({ t2i: 5, edit: 15, avatar: 255, music: 15, upscale: 215, motion: 205 }); // avatar: voice 15 + avatar 240
  // The edit's caption names its model and license, which the preset catalogue does not hold.
  expect(body.editModel).toEqual({ id: 'qwen-image-edit-2511', name: expect.stringMatching(/^Qwen-Image-Edit-2511/), license: 'Apache-2.0' });
});

test('a preview file that exists gets its URL, a missing one none', async () => {
  const root = libraryCopy((dir) => {
    // the repository's previews, replaced by Squish's alone
    rmSync(join(dir, 'presets', 'effects', 'previews'), { recursive: true, force: true });
    mkdirSync(join(dir, 'presets', 'effects', 'previews'), { recursive: true });
    writeFileSync(join(dir, 'presets', 'effects', 'previews', 'squish.mp4'), 'clip');
  });
  expect(await presetPreviewUrl(root, 'previews/squish.mp4', 'effects')).toBe('/media/presets/effects/previews/squish.mp4');
  expect(await presetPreviewUrl(root, 'previews/explode.mp4', 'effects')).toBeUndefined();
  process.env.MONTAGIO_EXTENSIONS = 'all';
  const body = await info();
  expect(body.effects.find((effect) => effect.id === 'squish')?.previewUrl).toBe('/media/presets/effects/previews/squish.mp4');
  expect(body.effects.find((effect) => effect.id === 'explode')).not.toHaveProperty('previewUrl');
});

test('/media/presets/<effects|transitions>/previews/<file> serves the file, and nothing else', async () => {
  libraryCopy((dir) => {
    mkdirSync(join(dir, 'presets', 'transitions', 'previews'), { recursive: true });
    writeFileSync(join(dir, 'presets', 'transitions', 'previews', 'iris-dive.mp4'), 'clip');
  });
  const get = (...path: string[]) => getMedia(new Request('http://localhost/media'), params({ path }));
  const ok = await get('presets', 'transitions', 'previews', 'iris-dive.mp4');
  expect(ok.status).toBe(200);
  expect(ok.headers.get('content-type')).toBe('video/mp4');
  expect((await get('presets', 'transitions', 'previews', '..', 'iris-dive.yaml')).status).toBe(400);
  expect((await get('presets', 'transitions', 'iris-dive.yaml')).status).toBe(400);
  expect((await get('presets', 'registry', 'previews', 'x.mp4')).status).toBe(400);
});
