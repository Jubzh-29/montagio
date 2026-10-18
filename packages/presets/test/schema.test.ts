import { readFileSync } from 'node:fs';
import { parsePreset, PresetError } from '../src/index';

const yaml = readFileSync(new URL('./fixtures/crash-push.yaml', import.meta.url), 'utf8');
const edit = (from: string, to: string) => {
  if (!yaml.includes(from)) throw new Error(`fixture does not contain "${from}"`);
  return yaml.replace(from, to);
};

test('parses the fixture with defaults applied', () => {
  const p = parsePreset(yaml, 'crash-push.yaml');
  expect(p.id).toBe('crash-push');
  expect(p.camera.poses).toEqual(['zoom_in']);
  expect(p.camera.speed).toBe(1.5);
  expect(p.defaults).toEqual({ duration_s: 5, resolution: '480p', fps: 16 });
  expect(p.loras).toEqual([]);
});

test('missing optional blocks get their defaults', () => {
  const minimal = yaml
    .replace(/defaults:\n(  .*\n)+/, '')
    .replace('  speed: 1.5\n', '');
  const p = parsePreset(minimal, 'minimal.yaml');
  expect(p.defaults).toEqual({ duration_s: 5, resolution: '480p', fps: 16 });
  expect(p.camera.speed).toBe(1);
});

test('CRLF input parses identically', () => {
  expect(parsePreset(yaml.replace(/\n/g, '\r\n'), 'x.yaml')).toEqual(parsePreset(yaml, 'x.yaml'));
});

test('unknown key is rejected with its path', () => {
  expect(() => parsePreset(edit('speed: 1.5', 'sped: 1.5'), 'crash-push.yaml'))
    .toThrow(/crash-push\.yaml.*camera.*sped/s);
});

test.each([
  ['id: crash-push', 'id: Crash Push'],
  ['poses: [zoom_in]', 'poses: [static, zoom_in]'],
  ['poses: [zoom_in]', 'poses: [zoom_in, zoom_in]'],
  ['poses: [zoom_in]', 'poses: [zoom_in, pan_left, pan_up]'],
  ['license: CC-BY-4.0', 'license: CC-BY-NC-4.0'],
  ['duration_s: 5', 'duration_s: 11'],
  ['duration_s: 5', 'duration_s: 1'],
  ['poses: [zoom_in]', 'poses: [zoom_in, zoom_out]\n  combine: sideways'],
  ['poses: [zoom_in]', 'poses: [zoom_in, zoom_in]\n  combine: then'],
])('rejects %s -> %s', (from, to) => {
  expect(() => parsePreset(edit(from, to), 'crash-push.yaml')).toThrow(PresetError);
});

test.each([
  ['duration_s: 5', 'duration_s: 2'],
  ['duration_s: 5', 'duration_s: 10'],
  ['poses: [zoom_in]', 'poses: [pan_up, zoom_in]'],
  ['poses: [zoom_in]', 'poses: [zoom_in, static]\n  combine: then'],
  ['poses: [zoom_in]', 'poses: [static, zoom_in]\n  combine: then'],
  ['poses: [zoom_in]', 'poses: [zoom_in]\n  combine: then'],
])('accepts %s -> %s', (from, to) => {
  expect(() => parsePreset(edit(from, to), 'crash-push.yaml')).not.toThrow();
});

test('two moves happen together unless the preset says then', () => {
  expect(parsePreset(edit('poses: [zoom_in]', 'poses: [pan_up, zoom_in]'), 'p.yaml').camera.combine).toBe('together');
  expect(parsePreset(edit('poses: [zoom_in]', 'poses: [zoom_in, static]\n  combine: then'), 'p.yaml').camera.combine).toBe('then');
});

test.each([
  ['zoom_in', 'zoom_out'],
  ['pan_right', 'pan_left'],
  ['pan_up', 'pan_down'],
  ['roll_cw', 'roll_ccw'],
])('opposite moves %s and %s would cancel out together, so they need then', (a, b) => {
  const together = edit('poses: [zoom_in]', `poses: [${a}, ${b}]`);
  expect(() => parsePreset(together, 'p.yaml')).toThrow(
    new RegExp(`camera\\.poses: "${a}" and "${b}" cancel out when combine is "together"; use combine: "then"`),
  );
  expect(parsePreset(`${together.replace(`poses: [${a}, ${b}]`, `poses: [${a}, ${b}]\n  combine: then`)}`, 'p.yaml').camera.combine).toBe('then');
});

test('static joins another move only when they come one after the other', () => {
  expect(() => parsePreset(edit('poses: [zoom_in]', 'poses: [static, zoom_in]'), 'p.yaml')).toThrow(
    /camera\.poses: "static" can only be combined with another pose when combine is "then"/,
  );
});

test('invalid YAML is reported as a PresetError naming the file', () => {
  expect(() => parsePreset('id: [unclosed', 'broken.yaml')).toThrow(/broken\.yaml/);
});
