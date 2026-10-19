import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The launchers run from the real checkout, whose path holds spaces on the development machine.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const hasBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).stdout?.startsWith('GNU bash') ?? false;
const onWindows = process.platform === 'win32';

let fakeDir: string;
beforeEach(() => {
  fakeDir = mkdtempSync(join(tmpdir(), 'montagio old node '));
});
afterEach(() => rmSync(fakeDir, { recursive: true, force: true }));

const pathWith = (dir: string) => `${dir}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
const envWith = (dir: string) => {
  const env = { ...process.env };
  delete env.Path;
  return { ...env, PATH: pathWith(dir) };
};

test.runIf(hasBash)('montagio.sh help runs the installer and exits 0', () => {
  const run = spawnSync('bash', [join(repoRoot, 'montagio.sh'), 'help'], { encoding: 'utf8', cwd: tmpdir() });
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('Usage');
}, 30_000);

test.runIf(hasBash)('montagio.sh refuses a Node.js older than 22.18 and says where to get one', () => {
  const fake = join(fakeDir, 'node');
  writeFileSync(fake, '#!/bin/sh\necho v20.11.0\n');
  chmodSync(fake, 0o755);
  const run = spawnSync('bash', [join(repoRoot, 'montagio.sh'), 'help'], { encoding: 'utf8', env: envWith(fakeDir) });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('22.18');
  expect(run.stderr).toContain('https://nodejs.org');
}, 30_000);

test.runIf(hasBash)('montagio.sh passes its exit code and its arguments through', () => {
  const run = spawnSync('bash', [join(repoRoot, 'montagio.sh'), 'install', '--bogus option'], { encoding: 'utf8' });
  expect(run.status).toBe(2);
  expect(run.stderr).toContain('--bogus option');
}, 30_000);

const powershell = (args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(repoRoot, 'montagio.ps1'), ...args], {
    encoding: 'utf8',
    env,
  });

test.runIf(onWindows)('montagio.ps1 help runs the installer and exits 0', () => {
  const run = powershell(['help']);
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('Usage');
}, 30_000);

test.runIf(onWindows)('montagio.ps1 refuses a Node.js older than 22.18 and says where to get one', () => {
  writeFileSync(join(fakeDir, 'node.cmd'), '@echo v20.11.0\r\n');
  const run = powershell(['help'], envWith(fakeDir));
  expect(run.status).toBe(1);
  expect(run.stdout + run.stderr).toContain('22.18');
  expect(run.stdout + run.stderr).toContain('https://nodejs.org');
}, 30_000);

test.runIf(onWindows)('montagio.ps1 passes its exit code and an argument with spaces through', () => {
  const run = powershell(['install', '--bogus option']);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain('--bogus option');
}, 30_000);
