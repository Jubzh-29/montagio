import { argvFrom, main, parseArgs } from '../src/cli.ts';

test('montagio.ps1 hands the arguments over as JSON, untouched by PowerShell 5.1', () => {
  expect(argvFrom({ MONTAGIO_ARGV: '["install","--dir=C:\\\\A B","--bogus option"]' }, ['ignored'])).toEqual(['install', '--dir=C:\\A B', '--bogus option']);
  expect(argvFrom({}, ['install', '--dry-run'])).toEqual(['install', '--dry-run']);
  expect(() => argvFrom({ MONTAGIO_ARGV: '{"a":1}' }, [])).toThrow(/MONTAGIO_ARGV/);
});

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
      demo: false,
      ports: { comfy: 8288 },
      extensions: null,
      lowVram: false,
    },
  });
});

test('--low-vram asks for the 12 GB profile of the full install', () => {
  expect(parseArgs(['install', '--low-vram']).options.lowVram).toBe(true);
  expect(parseArgs(['install']).options.lowVram).toBe(false);
  expect(() => parseArgs(['install', '--low-vram', '--app-only'])).toThrow(/--low-vram is a profile of the full install/);
  expect(() => parseArgs(['start', '--low-vram'])).toThrow(/--low-vram only goes with install/);
});

test('--extensions is read for install only, and left to MONTAGIO_EXTENSIONS or the default when absent', () => {
  expect(parseArgs(['install', '--extensions', 'music,edit']).options.extensions).toBe('music,edit');
  expect(parseArgs(['install']).options.extensions).toBeNull();
  expect(() => parseArgs(['start', '--extensions', 'all'])).toThrow(/--extensions only goes with install/);
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

test('start, stop and status refuse the options only install reads', () => {
  // start --dry-run used to start everything, start --app-port to start on the saved port.
  expect(() => parseArgs(['start', '--dry-run'])).toThrow(/--dry-run only goes with install/);
  expect(() => parseArgs(['start', '--app-port', '3300'])).toThrow(/--app-port only goes with install/);
  for (const command of ['stop', 'status']) {
    expect(() => parseArgs([command, '--app-only'])).toThrow(/--app-only/);
    expect(() => parseArgs([command, '--no-browser'])).toThrow(/--no-browser only goes with install or start/);
  }
  expect(parseArgs(['start', '--dir', 'D:\\S', '--no-browser']).options).toMatchObject({ dir: 'D:\\S', browser: false });
  expect(parseArgs(['status', '--dir', 'D:\\S']).command).toBe('status');
});

test('--proxy-url needs --app-only and an http(s) URL', () => {
  expect(() => parseArgs(['install', '--proxy-url', 'http://127.0.0.1:8189'])).toThrow(/--app-only/);
  expect(() => parseArgs(['install', '--app-only', '--proxy-url', 'ftp://x'])).toThrow(/http/);
  expect(parseArgs(['install', '--app-only', '--proxy-url', 'http://127.0.0.1:9189']).options).toMatchObject({ appOnly: true, proxyUrl: 'http://127.0.0.1:9189' });
});

test('--demo goes with --app-only, never with --proxy-url', () => {
  expect(parseArgs(['install', '--app-only', '--demo']).options).toMatchObject({ appOnly: true, demo: true, proxyUrl: null });
  expect(() => parseArgs(['install', '--demo'])).toThrow(/--app-only/);
  expect(() => parseArgs(['install', '--app-only', '--demo', '--proxy-url', 'http://127.0.0.1:9189'])).toThrow(/--demo/);
  expect(() => parseArgs(['start', '--demo'])).toThrow(/only goes with install/);
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
