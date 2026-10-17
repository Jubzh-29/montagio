import { readFileSync } from 'node:fs';
import { parseLock, parseModel, RegistryError } from '../src/index';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const model = read('wan-fun-camera.yaml');
const lock = read('models.lock.yaml');
const replaceOnce = (text: string, from: string | RegExp, to: string) => {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`fixture does not contain ${String(from)}`);
  return out;
};

test('parses the Fun-Camera model', () => {
  const m = parseModel(model, 'wan-fun-camera.yaml');
  expect(m.capabilities).toContain('i2v-camera');
  expect(m.bindings.camera_pose).toEqual({ node: '12', field: 'camera_pose' });
  expect(m.limits).toEqual({ resolutions: ['480p', '720p'], fps: [16], max_duration_s: 5 });
});

test('missing required binding is named', () => {
  const withoutPose = replaceOnce(model, /  camera_pose: .*\n/, '');
  expect(() => parseModel(withoutPose, 'm.yaml')).toThrow(/camera_pose/);
});

test('an i2v-only model does not need camera bindings', () => {
  const i2v = replaceOnce(
    replaceOnce(replaceOnce(model, 'capabilities: [i2v-camera]', 'capabilities: [i2v]'), /  camera_pose: .*\n/, ''),
    /  camera_speed: .*\n/,
    '',
  );
  expect(parseModel(i2v, 'i2v.yaml').capabilities).toEqual(['i2v']);
});

test('non-permissive model license is refused', () => {
  expect(() => parseModel(replaceOnce(model, 'license: Apache-2.0', 'license: LTX-2 Community'), 'm.yaml'))
    .toThrow(RegistryError);
});

test('workflow path outside workflows/ is refused', () => {
  expect(() => parseModel(replaceOnce(model, 'workflow: workflows/', 'workflow: ../'), 'm.yaml')).toThrow(/workflow/);
});

test('lock parses every entry', () => {
  const entries = parseLock(lock, 'models.lock.yaml');
  expect(entries.map((e) => e.id)).toEqual(['wan22-fun-camera-high', 'wan22-fun-camera-low', 'umt5-xxl-fp8', 'wan21-vae']);
  expect(entries[3]?.sha256).toBe('2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b');
});

test('lock: url outside huggingface.co is refused', () => {
  expect(() => parseLock(replaceOnce(lock, 'url: https://huggingface.co/', 'url: https://example.com/'), 'l.yaml'))
    .toThrow(/huggingface/);
});

test('lock: duplicate ids are refused', () => {
  const dup = replaceOnce(lock, '- id: wan22-fun-camera-low', '- id: wan22-fun-camera-high');
  expect(() => parseLock(dup, 'l.yaml')).toThrow(/duplicate.*wan22-fun-camera-high/);
});

test('lock: malformed sha256 is refused', () => {
  expect(() => parseLock(replaceOnce(lock, /sha256: [a-f0-9]+/, 'sha256: nothex'), 'l.yaml')).toThrow(/sha256/);
});
