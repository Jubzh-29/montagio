/** What the machine has: GPU, driver, tools, Pythons, free space, RAM, ports. Read-only. */
import { existsSync, statfsSync } from 'node:fs';
import { connect } from 'node:net';
import { totalmem } from 'node:os';
import { dirname } from 'node:path';
import type { Capture } from './exec.ts';
import type { Os } from './platform.ts';

export type Gpu = { index: number; name: string; vramMiB: number; driver: string };
export type PythonInfo = { command: string[]; version: [number, number, number]; hasVenv: boolean };

export type MachineFacts = {
  os: Os | null;
  platform: string;
  arch: string;
  node: [number, number, number];
  git: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  gpus: Gpu[];
  /** The highest CUDA version the driver supports (nvidia-smi banner), null without nvidia-smi. */
  driverCuda: [number, number] | null;
  pythons: PythonInfo[];
  freeBytes: { installDir: number; repo: number };
  ramBytes: number;
  /** Ports among the wanted ones that something already answers on. */
  busyPorts: number[];
};

export function parseNvidiaSmiCsv(text: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 4) continue;
    const index = Number(parts[0]);
    const vram = /^(\d+)\s*MiB$/i.exec(parts[2]!);
    if (!Number.isInteger(index) || !vram) continue;
    gpus.push({ index, name: parts[1]!, vramMiB: Number(vram[1]), driver: parts[3]! });
  }
  return gpus;
}

/** "CUDA Version: 13.0" (R5xx drivers) or "CUDA UMD Version: 13.4" (R6xx). */
export function parseCudaBanner(text: string): [number, number] | null {
  const match = /CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function parsePythonVersion(text: string): [number, number, number] | null {
  const match = /^Python (\d+)\.(\d+)\.(\d+)/m.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** In order of preference. 3.14 is left out: some of ComfyUI's dependencies have no wheel for it yet. */
export function pythonCandidates(os: Os): string[][] {
  const minors = ['3.12', '3.13', '3.11', '3.10'];
  return os === 'windows' ? [...minors.map((v) => ['py', `-${v}`]), ['python']] : [...minors.map((v) => [`python${v}`]), ['python3']];
}

/** Free bytes for a path that may not exist yet: measured on its nearest existing parent. */
export function freeBytesAt(path: string): number {
  let dir = path;
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const stats = statfsSync(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

/** Something answers on 127.0.0.1:port. */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function versionOf(text: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = text.split('.').map(Number);
  return [major, minor, patch];
}

export async function probe(input: {
  os: Os | null;
  repoRoot: string;
  installDir: string;
  ports: number[];
  capture: Capture;
  env?: Record<string, string | undefined>;
}): Promise<MachineFacts> {
  const { capture, os } = input;
  const env = input.env ?? process.env;
  const answers = async (cmd: string, args: string[]) => (await capture(cmd, args)).code === 0;

  const smi = await capture('nvidia-smi', ['--query-gpu=index,name,memory.total,driver_version', '--format=csv,noheader']);
  const gpus = smi.code === 0 ? parseNvidiaSmiCsv(smi.stdout) : [];
  const banner = smi.code === 0 ? await capture('nvidia-smi', []) : null;

  const pythons: PythonInfo[] = [];
  for (const [cmd, ...pre] of pythonCandidates(os ?? 'linux')) {
    const answer = await capture(cmd!, [...pre, '--version']);
    const version = answer.code === 0 ? parsePythonVersion(answer.stdout + answer.stderr) : null;
    if (!version) continue;
    pythons.push({ command: [cmd!, ...pre], version, hasVenv: await answers(cmd!, [...pre, '-c', 'import venv, ensurepip']) });
  }

  const busyPorts: number[] = [];
  for (const port of input.ports) if (await portBusy(port)) busyPorts.push(port);

  return {
    os,
    platform: process.platform,
    arch: process.arch,
    node: versionOf(process.versions.node),
    git: await answers('git', ['--version']),
    ffmpeg: await answers(env.MONTAGIO_FFMPEG || 'ffmpeg', ['-version']),
    ffprobe: await answers(env.MONTAGIO_FFPROBE || 'ffprobe', ['-version']),
    gpus,
    driverCuda: banner && banner.code === 0 ? parseCudaBanner(banner.stdout) : null,
    pythons,
    freeBytes: { installDir: freeBytesAt(input.installDir), repo: freeBytesAt(input.repoRoot) },
    ramBytes: totalmem(),
    busyPorts,
  };
}
