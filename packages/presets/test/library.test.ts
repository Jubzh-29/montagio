import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, LibraryError } from '../src/index';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));

function toCrlf(dir: string) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) toCrlf(path);
    else writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
}

let crlfRoot = '';
beforeAll(() => {
  crlfRoot = join(mkdtempSync(join(tmpdir(), 'montagio-crlf-')), 'repo');
  cpSync(fixture('repo-ok'), crlfRoot, { recursive: true });
  toCrlf(crlfRoot);
});

test('loads the ok fixture repo', async () => {
  const lib = await loadLibrary(fixture('repo-ok'));
  expect([...lib.presets.keys()]).toEqual(['crash-push']);
  expect(lib.models.get('wan22-i2v-a14b-fun-camera')?.tier).toBe('quality');
  expect(lib.lock.size).toBe(4);
  expect(lib.templates.get('workflows/wan22-fun-camera.api.json')?.['12']?.class_type).toBe('WanCameraEmbedding');
});

test('a missing preview is only a warning', async () => {
  const lib = await loadLibrary(fixture('repo-ok'));
  expect(lib.warnings).toEqual([expect.stringMatching(/crash-push.*previews\/crash-push\.mp4/)]);
});

test('reports every problem at once', async () => {
  const error = await loadLibrary(fixture('repo-broken')).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LibraryError);
  expect((error as LibraryError).problems).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/crash-push.*unknown model.*wan-missing/),
      expect.stringMatching(/crash-push.*unknown model.*wan22-ti2v-5b/),
      expect.stringMatching(/wan22-i2v-a14b-fun-camera.*weights.*not-in-lock.*not in lock/),
    ]),
  );
});

test('CRLF files load', async () => {
  const lib = await loadLibrary(crlfRoot);
  expect(lib.presets.size).toBe(1);
  expect(lib.models.size).toBe(1);
});

test('the real repository library loads', async () => {
  const lib = await loadLibrary(repoRoot());
  expect([...lib.models.keys()].sort()).toEqual(['wan22-i2v-a14b-fun-camera', 'wan22-ti2v-5b', 'z-image-turbo']);
  expect(lib.presets.size).toBeGreaterThanOrEqual(3);
});
