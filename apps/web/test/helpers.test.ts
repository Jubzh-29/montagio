import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupTempData } from './helpers';

const dataDir = setupTempData();
let previous = '';

// In this order: the second test looks at what the first one left behind.
test('each test gets a data directory of its own', () => {
  previous = dataDir();
  mkdirSync(join(previous, 'generations', 'g1'), { recursive: true });
  writeFileSync(join(previous, 'generations', 'g1', 'clip.mp4'), 'clip');
  expect(existsSync(join(previous, 'generations', 'g1', 'clip.mp4'))).toBe(true);
});

test('the data directory of the previous test is gone', () => {
  expect(dataDir()).not.toBe(previous);
  expect(existsSync(previous)).toBe(false);
});
