import { fileURLToPath } from 'node:url';
import { DEFAULT_PORTS, decide, evaluate, MIN_VRAM_MIB, pickGpu, pickPython, pickTorch, type Check } from '../src/checks.ts';
import { readVersions } from '../src/pins.ts';
import type { Gpu, MachineFacts } from '../src/probe.ts';

const versions = readVersions(fileURLToPath(new URL('../../../', import.meta.url)));
const GiB = 1024 ** 3;

const gpu = (vramMiB: number, index = 0, name = 'NVIDIA GeForce RTX 4090'): Gpu => ({ index, name, vramMiB, driver: '580.65' });

function facts(over: Partial<MachineFacts> = {}): MachineFacts {
  return {
    os: 'windows',
    platform: 'win32',
    arch: 'x64',
    node: [22, 23, 2],
    git: true,
    ffmpeg: true,
    ffprobe: true,
    gpus: [gpu(24564)],
    driverCuda: [13, 0],
    pythons: [{ command: ['py', '-3.12'], version: [3, 12, 10], hasVenv: true }],
    freeBytes: { installDir: 500 * GiB, repo: 500 * GiB },
    ramBytes: 64 * GiB,
    busyPorts: [],
    ...over,
  };
}

const ctx = { mode: 'full' as const, versions, ports: DEFAULT_PORTS, ownPorts: [] as number[], need: { installDir: 90 * GiB, repo: 3 * GiB }, ignoreVram: false };
const byId = (checks: Check[], id: Check['id']) => checks.find((check) => check.id === id);

test('pickGpu takes the GPU with the most VRAM, the lowest index on a tie', () => {
  expect(pickGpu([gpu(4096, 0), gpu(24564, 1)])?.index).toBe(1);
  expect(pickGpu([gpu(24564, 0), gpu(24564, 1)])?.index).toBe(0);
  expect(pickGpu([])).toBeNull();
});

test('pickPython prefers 3.12 over 3.14 and skips a Python without venv', () => {
  const p = (minor: number, hasVenv = true) => ({ command: ['py', `-3.${minor}`], version: [3, minor, 0] as [number, number, number], hasVenv });
  expect(pickPython([p(14), p(12)])?.version).toEqual([3, 12, 0]);
  expect(pickPython([p(12, false), p(11)])?.version).toEqual([3, 11, 0]);
  expect(pickPython([p(9), p(14)])).toBeNull();
});

test('pickTorch follows the CUDA version of the driver', () => {
  expect(pickTorch([13, 0], versions)?.cuda).toBe('cu130');
  expect(pickTorch([13, 2], versions)?.torch).toBe('2.14.1');
  expect(pickTorch([12, 8], versions)).toMatchObject({ cuda: 'cu128', torch: '2.11.0' });
  expect(pickTorch([12, 4], versions)).toBeNull();
  expect(pickTorch(null, versions)).toBeNull();
});

test('24 GB cards pass, even when nvidia-smi reports them under 24 GiB', () => {
  expect(MIN_VRAM_MIB).toBe(22528);
  expect(byId(evaluate(facts({ gpus: [gpu(23028, 0, 'NVIDIA L4')] }), ctx), 'gpu')?.severity).toBe('ok');
  expect(byId(evaluate(facts({ gpus: [gpu(24564)] }), ctx), 'gpu')?.severity).toBe('ok');
});

test('a GPU under 22 GiB fails, and --ignore-vram turns it into a warning', () => {
  for (const vram of [20480, 4096]) {
    const check = byId(evaluate(facts({ gpus: [gpu(vram)] }), ctx), 'gpu')!;
    expect(check.severity).toBe('fail');
    expect(check.fix).toContain('--app-only');
  }
  expect(byId(evaluate(facts({ gpus: [gpu(16384)] }), { ...ctx, ignoreVram: true }), 'gpu')?.severity).toBe('warn');
});

test('no NVIDIA GPU fails even with --ignore-vram, and the driver is not judged', () => {
  const checks = evaluate(facts({ gpus: [], driverCuda: null }), { ...ctx, ignoreVram: true });
  expect(byId(checks, 'gpu')?.severity).toBe('fail');
  expect(byId(checks, 'driver')).toBeUndefined();
});

test('the driver picks cu130, falls back to cu128 with a warning, and fails below 12.8', () => {
  expect(byId(evaluate(facts(), ctx), 'driver')?.severity).toBe('ok');
  expect(byId(evaluate(facts({ driverCuda: [12, 8] }), ctx), 'driver')).toMatchObject({ severity: 'warn' });
  const old = byId(evaluate(facts({ driverCuda: [12, 4] }), ctx), 'driver')!;
  expect(old.severity).toBe('fail');
  expect(old.fix).toContain('update the NVIDIA driver (R580 or newer for CUDA 13.0)');
});

test('decide offers the app alone when only the GPU fails, and stops otherwise', () => {
  const weak = evaluate(facts({ gpus: [gpu(4096)] }), ctx);
  expect(decide(weak, 'full')).toMatchObject({ kind: 'offer-app-only' });
  expect(decide(evaluate(facts({ gpus: [gpu(4096)], ffmpeg: false }), ctx), 'full')).toEqual({ kind: 'stop' });
  expect(decide(evaluate(facts(), ctx), 'full')).toEqual({ kind: 'proceed', mode: 'full' });
});

test('decide still offers the app alone when full-mode checks fail beside the GPU', () => {
  // A 4 GB laptop: no room for 70 GB of weights, no Python in range, yet the app alone fits.
  const checks = evaluate(facts({ gpus: [gpu(4096)], pythons: [], freeBytes: { installDir: 40 * GiB, repo: 40 * GiB } }), ctx);
  expect(decide(checks, 'full')).toMatchObject({ kind: 'offer-app-only' });
});

test('a busy port that is not ours fails and names the option', () => {
  const check = byId(evaluate(facts({ busyPorts: [8188] }), ctx), 'ports')!;
  expect(check.severity).toBe('fail');
  expect(check.message).toContain('8188');
  expect(check.fix).toContain('--comfy-port');
  expect(byId(evaluate(facts({ busyPorts: [8188] }), { ...ctx, ownPorts: [8188] }), 'ports')?.severity).toBe('ok');
  expect(byId(evaluate(facts({ busyPorts: [3000] }), ctx), 'ports')?.fix).toContain('--app-port');
});

test('the app alone needs neither Python, nor a GPU, nor a driver, and only its own port', () => {
  const checks = evaluate(facts({ gpus: [], driverCuda: null, pythons: [], git: false, ramBytes: 8 * GiB, busyPorts: [8188, 8189] }), {
    ...ctx,
    mode: 'app-only',
    need: { installDir: 0, repo: 3 * GiB },
  });
  expect(checks.map((check) => check.id)).not.toEqual(expect.arrayContaining(['python']));
  for (const id of ['python', 'gpu', 'driver', 'ram', 'git'] as const) expect(byId(checks, id)).toBeUndefined();
  expect(checks.every((check) => check.severity !== 'fail')).toBe(true);
  expect(byId(checks, 'ports')?.message).toBe('port 3000');
  expect(byId(evaluate(facts(), ctx), 'ports')?.message).toBe('ports 8188, 8189, 3000');
  expect(decide(checks, 'app-only')).toEqual({ kind: 'proceed', mode: 'app-only' });
});

test('too little disk fails with both sizes, and little RAM warns', () => {
  const disk = byId(evaluate(facts({ freeBytes: { installDir: 50 * GiB, repo: 500 * GiB } }), ctx), 'disk')!;
  expect(disk.severity).toBe('fail');
  expect(disk.message).toContain('50.0 GiB');
  expect(disk.message).toContain('90.0 GiB');
  expect(disk.fix).toContain('--dir');
  expect(byId(evaluate(facts({ ramBytes: 16 * GiB }), ctx), 'ram')?.severity).toBe('warn');
});

test('each failure gives the fix of its system', () => {
  const windows = evaluate(facts({ pythons: [], ffmpeg: false, git: false, node: [20, 11, 0] }), ctx);
  expect(byId(windows, 'python')?.fix).toContain('winget install Python.Python.3.12');
  expect(byId(windows, 'ffmpeg')?.fix).toContain('winget install Gyan.FFmpeg');
  expect(byId(windows, 'git')?.fix).toContain('winget install Git.Git');
  expect(byId(windows, 'node')?.fix).toContain('winget install OpenJS.NodeJS.LTS');
  const linux = evaluate(facts({ os: 'linux', platform: 'linux', pythons: [], ffmpeg: false, git: false }), ctx);
  expect(byId(linux, 'python')?.fix).toContain('sudo apt install python3.12-venv');
  expect(byId(linux, 'ffmpeg')?.fix).toContain('sudo apt install ffmpeg');
  expect(byId(linux, 'git')?.fix).toContain('sudo apt install git');
});

test('a Python in range without venv says what to install', () => {
  const check = byId(evaluate(facts({ os: 'linux', platform: 'linux', pythons: [{ command: ['python3.12'], version: [3, 12, 3], hasVenv: false }] }), ctx), 'python')!;
  expect(check.severity).toBe('fail');
  expect(check.message).toContain('venv');
});

test('macOS fails and points to the demo link', () => {
  const check = byId(evaluate(facts({ os: null, platform: 'darwin', arch: 'arm64' }), ctx), 'os')!;
  expect(check.severity).toBe('fail');
  expect(check.fix).toContain('demo link');
});
