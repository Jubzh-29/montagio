import { main, parseArgs } from '../src/cli.ts';

test('install options are read', () => {
  expect(parseArgs(['install', '--dry-run', '--ignore-vram', '--dir', 'D:\\Shot Rig', '--comfy-port', '8288', '--no-start', '--no-browser'])).toEqual({
    command: 'install',
    options: {
      dryRun: true,
      appOnly: false,
      ignoreVram: true,
      dir: 'D:\\Shot Rig',
      start: false,
      browser: false,
      proxyUrl: null,
      ports: { comfy: 8288 },
    },
  });
});

test('no command means help', () => {
  expect(parseArgs([]).command).toBe('help');
});

test('an unknown option, an unknown command or a bad port is refused', () => {
  expect(() => parseArgs(['install', '--bogus'])).toThrow(/--bogus/);
  expect(() => parseArgs(['launch'])).toThrow(/launch/);
  expect(() => parseArgs(['install', '--app-port', '70000'])).toThrow(/--app-port/);
  expect(() => parseArgs(['install', '--app-port', 'abc'])).toThrow(/--app-port/);
});

test('--proxy-url needs --app-only and an http(s) URL', () => {
  expect(() => parseArgs(['install', '--proxy-url', 'http://127.0.0.1:8189'])).toThrow(/--app-only/);
  expect(() => parseArgs(['install', '--app-only', '--proxy-url', 'ftp://x'])).toThrow(/http/);
  expect(parseArgs(['install', '--app-only', '--proxy-url', 'http://127.0.0.1:9189']).options).toMatchObject({ appOnly: true, proxyUrl: 'http://127.0.0.1:9189' });
});

test('status, start and stop work on a folder where nothing is installed', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'montagio cli '));
  const out: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
  try {
    expect(await main(['status', '--dir', dir])).toBe(0);
    expect(out.join('\n')).toContain('mode: not installed');
    expect(await main(['stop', '--dir', dir])).toBe(0);
    expect(await main(['start', '--dir', dir, '--no-browser'])).toBe(1);
    expect(out.join('\n')).toContain('not installed');
  } finally {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('help prints the usage and exits 0, a bad argument exits 2', async () => {
  const out: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(await main(['help'])).toBe(0);
    expect(out.join('\n')).toContain('Usage');
    expect(await main(['install', '--bogus'])).toBe(2);
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
});
