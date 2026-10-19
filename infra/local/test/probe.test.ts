import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capture, Captured } from '../src/exec.ts';
import { freeBytesAt, parseCudaBanner, parseNvidiaSmiCsv, parsePythonVersion, portBusy, probe, pythonCandidates } from '../src/probe.ts';

test('parseNvidiaSmiCsv reads every GPU and skips unreadable lines', () => {
  const csv = '0, NVIDIA GeForce RTX 3050 Laptop GPU, 4096 MiB, 616.92\n1, NVIDIA GeForce RTX 4090, 24564 MiB, 580.65\nNo devices were found\n';
  expect(parseNvidiaSmiCsv(csv)).toEqual([
    { index: 0, name: 'NVIDIA GeForce RTX 3050 Laptop GPU', vramMiB: 4096, driver: '616.92' },
    { index: 1, name: 'NVIDIA GeForce RTX 4090', vramMiB: 24564, driver: '580.65' },
  ]);
});

test('parseCudaBanner reads the highest CUDA version the driver supports', () => {
  expect(parseCudaBanner('| NVIDIA-SMI 580.65  Driver Version: 580.65  CUDA Version: 13.0 |')).toEqual([13, 0]);
  expect(parseCudaBanner('NVIDIA-SMI has failed')).toBeNull();
});

test('parseCudaBanner reads the R6xx banner, which says "CUDA UMD Version"', () => {
  expect(parseCudaBanner('| NVIDIA-SMI 616.92                 KMD Version: 616.92        CUDA UMD Version: 13.4     |')).toEqual([13, 4]);
});

test('parsePythonVersion reads a version and refuses the Microsoft Store stub', () => {
  expect(parsePythonVersion('Python 3.12.10\n')).toEqual([3, 12, 10]);
  expect(parsePythonVersion('Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut')).toBeNull();
});

test('the Python candidates prefer 3.12 and never ask for 3.14', () => {
  expect(pythonCandidates('windows')).toEqual([['py', '-3.12'], ['py', '-3.13'], ['py', '-3.11'], ['py', '-3.10'], ['python']]);
  expect(pythonCandidates('linux')).toEqual([['python3.12'], ['python3.13'], ['python3.11'], ['python3.10'], ['python3']]);
});

test('freeBytesAt measures the nearest existing folder and creates nothing', async () => {
  const base = mkdtempSync(join(tmpdir(), 'montagio-free-'));
  try {
    const target = join(base, 'absent', 'deeper');
    expect(freeBytesAt(target)).toBeGreaterThan(0);
    expect((await import('node:fs')).existsSync(join(base, 'absent'))).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('portBusy sees a listening port, then a free one', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  expect(await portBusy(port)).toBe(true);
  await new Promise((resolve) => server.close(resolve));
  expect(await portBusy(port)).toBe(false);
});

const ok = (stdout: string): Captured => ({ code: 0, stdout, stderr: '' });
const missing: Captured = { code: null, stdout: '', stderr: '' };

function fakeCapture(answers: Record<string, Captured>, calls: string[]): Capture {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    return answers[key] ?? missing;
  };
}

test('probe gathers the GPU, the driver, the tools and the Pythons that answer', async () => {
  const calls: string[] = [];
  const capture = fakeCapture(
    {
      'nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv,noheader': ok('0, NVIDIA GeForce RTX 4090, 24564 MiB, 580.65\n'),
      'nvidia-smi': ok('| Driver Version: 580.65  CUDA Version: 13.0 |'),
      'git --version': ok('git version 2.51.0'),
      'ffmpeg -version': ok('ffmpeg version 8'),
      'ffprobe -version': ok('ffprobe version 8'),
      'py -3.12 --version': ok('Python 3.12.10'),
      'py -3.12 -c import venv, ensurepip': ok(''),
      python: { code: 9009, stdout: '', stderr: 'Python was not found; run without arguments to install from the Microsoft Store' },
      'python --version': { code: 9009, stdout: '', stderr: 'Python was not found; run without arguments to install from the Microsoft Store' },
    },
    calls,
  );
  const facts = await probe({ os: 'windows', repoRoot: tmpdir(), installDir: join(tmpdir(), 'nope', 'Montagio'), ports: [], capture, env: {} });
  expect(facts.gpus).toEqual([{ index: 0, name: 'NVIDIA GeForce RTX 4090', vramMiB: 24564, driver: '580.65' }]);
  expect(facts.driverCuda).toEqual([13, 0]);
  expect(facts).toMatchObject({ os: 'windows', git: true, ffmpeg: true, ffprobe: true, busyPorts: [] });
  expect(facts.pythons).toEqual([{ command: ['py', '-3.12'], version: [3, 12, 10], hasVenv: true }]);
  expect(facts.node[0]).toBeGreaterThanOrEqual(22);
  expect(facts.ramBytes).toBeGreaterThan(0);
  expect(facts.freeBytes.installDir).toBeGreaterThan(0);
  expect(calls.some((call) => call.includes('-3.14'))).toBe(false);
});

test('probe without nvidia-smi finds no GPU and no driver', async () => {
  const facts = await probe({ os: 'linux', repoRoot: tmpdir(), installDir: tmpdir(), ports: [], capture: fakeCapture({}, []), env: {} });
  expect(facts.gpus).toEqual([]);
  expect(facts.driverCuda).toBeNull();
  expect(facts.pythons).toEqual([]);
  expect(facts).toMatchObject({ git: false, ffmpeg: false, ffprobe: false });
});

test('probe asks MONTAGIO_FFMPEG and MONTAGIO_FFPROBE when they are set', async () => {
  const calls: string[] = [];
  await probe({ os: 'linux', repoRoot: tmpdir(), installDir: tmpdir(), ports: [], capture: fakeCapture({}, calls), env: { MONTAGIO_FFMPEG: '/o/ff', MONTAGIO_FFPROBE: '/o/fp' } });
  expect(calls).toContain('/o/ff -version');
  expect(calls).toContain('/o/fp -version');
});
