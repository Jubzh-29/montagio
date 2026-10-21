import { fileURLToPath } from 'node:url';
import { loadLibrary, type Library } from '@montagio/presets';
import { parseManifest } from '../src/manifest';
import { planClips, strayClips } from '../src/plan';
import { INITIAL_MANIFEST } from './fixtures';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SHA = 'b'.repeat(64);
let library: Library;

beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

const twoSamples = (clips: string) =>
  parseManifest(
    INITIAL_MANIFEST.replace(/ {2}- id: portrait-a[\s\S]*?(?=clips:)/, '').replace('clips: []\n', `clips:\n${clips}`),
    'manifest.yaml',
  );
const entry = (preset: string, sample: string) =>
  `  - { preset: ${preset}, sample: ${sample}, seed: 7, sha256: ${SHA}, image_sha256: ${SHA}, workflow_sha256: ${SHA}, rendered_at: 2026-10-24 }\n`;

test('plans every preset for every sample, rendered or not', () => {
  const manifest = twoSamples(entry('crash-push', 'landscape-b'));
  expect(manifest.samples).toHaveLength(2);
  const planned = planClips(manifest, library);
  expect(planned).toHaveLength(library.presets.size * 2);
  expect(library.presets.size).toBe(11);
  const rendered = planned.filter((clip) => clip.rendered !== null);
  expect(rendered).toHaveLength(1);
  expect(rendered[0]).toMatchObject({
    file: 'clips/crash-push--landscape-b.mp4',
    vertical: 'clips/crash-push--landscape-b.9x16.mp4',
    workflow: 'workflows/crash-push--landscape-b.json',
    rendered: { seed: 7 },
  });
  expect(rendered[0]!.preset.id).toBe('crash-push');
  expect(rendered[0]!.sample.id).toBe('landscape-b');
  // Library order first, then sample order.
  expect(planned.slice(0, 2).map((clip) => clip.sample.id)).toEqual(['landscape-a', 'landscape-b']);
  expect(planned[0]!.preset.id).toBe([...library.presets.keys()][0]);
});

test('strayClips lists a clip whose preset left the library', () => {
  const manifest = twoSamples(entry('crash-push', 'landscape-a') + entry('gone-preset', 'landscape-a'));
  expect(strayClips(manifest, library).map((clip) => clip.preset)).toEqual(['gone-preset']);
  expect(planClips(manifest, library).every((clip) => clip.preset.id !== 'gone-preset')).toBe(true);
});
