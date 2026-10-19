import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, validatePreset, type Library } from '@montagio/presets';
import { remixLibrary } from '../src/prepare';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let library: Library;
beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

test('the remix library of data.json carries the weights of the camera presets, none of the extensions', () => {
  const lock = new Map(remixLibrary(library).lock);
  expect([...lock.values()].filter((entry) => entry.extension)).toEqual([]);
  expect([...library.lock.values()].filter((entry) => entry.extension).length).toBeGreaterThan(0);
  for (const model of library.models.values()) {
    for (const weight of model.weights) expect(lock.has(weight), `${model.id}: ${weight}`).toBe(true);
  }
});

test('a camera preset still validates in the page against the remix library', () => {
  const { models, templates, lock } = remixLibrary(library);
  const yaml = readFileSync(join(repoRoot, 'presets', 'crash-push.yaml'), 'utf8');
  expect(validatePreset(yaml, 'remix.yaml', { models: new Map(models), templates: new Map(templates), lock: new Map(lock) })).toMatchObject({ ok: true });
});
