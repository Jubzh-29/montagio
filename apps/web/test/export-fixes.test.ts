import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flattenSegmentPrefetches } from '../scripts/export-fixes.mjs';

let out = '';
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'montagio-export-'));
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

test('copies each nested segment prefetch to the flat name the client asks for', () => {
  // What next build (16.4.2, output: export) writes for /open-stack/...
  mkdirSync(join(out, 'open-stack', '__next.open-stack'), { recursive: true });
  writeFileSync(join(out, 'open-stack', '__next.open-stack', '__PAGE__.txt'), 'segment payload');
  // ...and what the root already has under its flat name.
  writeFileSync(join(out, '__next.__PAGE__.txt'), 'root payload');

  expect(flattenSegmentPrefetches(out)).toEqual(['open-stack/__next.open-stack.__PAGE__.txt']);
  // The client asks /open-stack/__next.open-stack.__PAGE__.txt (segment path with "/" turned into ".").
  expect(readFileSync(join(out, 'open-stack', '__next.open-stack.__PAGE__.txt'), 'utf8')).toBe('segment payload');
  expect(existsSync(join(out, 'open-stack', '__next.open-stack', '__PAGE__.txt'))).toBe(true);
  expect(readFileSync(join(out, '__next.__PAGE__.txt'), 'utf8')).toBe('root payload');
});

test('flattens deeper segments and leaves _next alone', () => {
  mkdirSync(join(out, 'a', '__next.a', 'b'), { recursive: true });
  writeFileSync(join(out, 'a', '__next.a', 'b', '__PAGE__.txt'), 'deep');
  mkdirSync(join(out, '_next', 'static'), { recursive: true });
  writeFileSync(join(out, '_next', 'static', 'x.js'), 'js');
  expect(flattenSegmentPrefetches(out)).toEqual(['a/__next.a.b.__PAGE__.txt']);
  expect(readFileSync(join(out, 'a', '__next.a.b.__PAGE__.txt'), 'utf8')).toBe('deep');
});
