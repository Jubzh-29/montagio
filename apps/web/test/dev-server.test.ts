import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('npm run dev answers this machine only, as the installer starts the app', () => {
  const { scripts } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  // next dev listens on every address unless told: its pages would answer the whole local network.
  expect(scripts.dev).toBe('next dev -H 127.0.0.1');
  expect(scripts.start).toBe('next start -H 127.0.0.1');
});
