import { clipFile, ManifestError, parseManifest, verticalFile, workflowFile } from '../src/manifest';
import { INITIAL_MANIFEST } from './fixtures';


const SHA = 'a'.repeat(64);
const clip = (preset: string, sample: string) =>
  `  - { preset: ${preset}, sample: ${sample}, seed: 42, sha256: ${SHA}, image_sha256: ${SHA}, workflow_sha256: ${SHA}, rendered_at: 2026-10-24 }\n`;

function problemsOf(text: string): string[] {
  try {
    parseManifest(text, 'manifest.yaml');
  } catch (error) {
    if (error instanceof ManifestError) return error.problems;
    throw error;
  }
  throw new Error('expected a ManifestError');
}

test('parses the initial manifest', () => {
  const manifest = parseManifest(INITIAL_MANIFEST, 'manifest.yaml');
  expect(manifest.model).toBe('wan22-i2v-a14b-fun-camera');
  expect(manifest.samples.map((sample) => [sample.id, sample.aspect, sample.status])).toEqual([
    ['landscape-a', '16:9', 'placeholder'],
    ['landscape-b', '16:9', 'placeholder'],
    ['portrait-a', '9:16', 'placeholder'],
  ]);
  expect(manifest.samples[0]!.title).toEqual({ en: 'Placeholder landscape A', fr: 'Paysage provisoire A' });
  expect(manifest.clips).toEqual([]);
});

test('reads a rendered clip entry', () => {
  const manifest = parseManifest(INITIAL_MANIFEST.replace('clips: []\n', `clips:\n${clip('crash-push', 'landscape-a')}`), 'm.yaml');
  expect(manifest.clips).toEqual([
    { preset: 'crash-push', sample: 'landscape-a', seed: 42, sha256: SHA, image_sha256: SHA, workflow_sha256: SHA, rendered_at: '2026-10-24' },
  ]);
});

test('refuses a duplicate sample id, a duplicate pair, a clip of an unknown sample, a bad sha256 and an unknown key', () => {
  const duplicateSample = INITIAL_MANIFEST.replace('id: landscape-b', 'id: landscape-a');
  expect(problemsOf(duplicateSample)).toContainEqual(expect.stringMatching(/^samples\.1\.id: duplicate sample id "landscape-a"/));

  const duplicatePair = INITIAL_MANIFEST.replace('clips: []\n', `clips:\n${clip('crash-push', 'landscape-a')}${clip('crash-push', 'landscape-a')}`);
  expect(problemsOf(duplicatePair)).toContainEqual(expect.stringMatching(/^clips\.1: duplicate clip crash-push × landscape-a/));

  const unknownSample = INITIAL_MANIFEST.replace('clips: []\n', `clips:\n${clip('crash-push', 'nowhere')}`);
  expect(problemsOf(unknownSample)).toContainEqual(expect.stringMatching(/^clips\.0\.sample: unknown sample "nowhere"/));

  const badSha = INITIAL_MANIFEST.replace('clips: []\n', `clips:\n${clip('crash-push', 'landscape-a').replace(`sha256: ${SHA},`, 'sha256: xyz,')}`);
  expect(problemsOf(badSha)).toContainEqual(expect.stringMatching(/^clips\.0\.sha256: /));

  const unknownKey = INITIAL_MANIFEST.replace('clips: []', 'clips: []\nextra: 1');
  expect(problemsOf(unknownKey)).toContainEqual(expect.stringMatching(/^\(root\)\.extra: /));

  expect(problemsOf('schema: [')).toContainEqual(expect.stringMatching(/invalid YAML/));
});

test('clipFile, verticalFile and workflowFile follow the canonical names', () => {
  expect(clipFile('crash-push', 'landscape-a')).toBe('clips/crash-push--landscape-a.mp4');
  expect(verticalFile('crash-push', 'landscape-a')).toBe('clips/crash-push--landscape-a.9x16.mp4');
  expect(workflowFile('crash-push', 'landscape-a')).toBe('workflows/crash-push--landscape-a.json');
});
