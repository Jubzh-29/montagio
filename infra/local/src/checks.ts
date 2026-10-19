/** What the machine lacks for each mode, how to fix it, and whether to go on. Pure. */
import type { TorchPin, Versions } from './pins.ts';
import type { Os } from './platform.ts';
import type { Gpu, MachineFacts, PythonInfo } from './probe.ts';

export type Mode = 'full' | 'app-only';
export type Ports = { comfy: number; proxy: number; app: number };

export const DEFAULT_PORTS: Ports = { comfy: 8188, proxy: 8189, app: 3000 };
/** 22 GiB: 24 GB cards report less (L4 and A10: 23028 MiB, RTX 4090: 24564 MiB), 20 GB cards stay out. */
export const MIN_VRAM_MIB = 22 * 1024;
export const MIN_NODE: [number, number] = [22, 18];
export const PYTHON_RANGE = { min: [3, 10] as [number, number], max: [3, 13] as [number, number] };
/** 30 GiB: a 32 GB machine reports about 31.8 GiB (the firmware and an integrated GPU keep some), 24 GB stays under. */
export const RAM_WARN_BYTES = 30 * 1024 ** 3;

export type CheckId = 'os' | 'node' | 'git' | 'python' | 'ffmpeg' | 'gpu' | 'driver' | 'disk' | 'ram' | 'ports';
export type Check = { id: CheckId; severity: 'ok' | 'warn' | 'fail'; message: string; fix?: string };

export type Decision = { kind: 'proceed'; mode: Mode } | { kind: 'offer-app-only'; reason: string } | { kind: 'stop' };

/** Checks whose failure also stops the app alone: offering it would not help. */
const BOTH_MODES: CheckId[] = ['os', 'node', 'ffmpeg'];

const PORT_OPTIONS: Record<keyof Ports, { option: string; label: string }> = {
  comfy: { option: '--comfy-port', label: 'ComfyUI' },
  proxy: { option: '--proxy-port', label: 'comfy-api-proxy' },
  app: { option: '--app-port', label: 'the Montagio app' },
};

const APP_ONLY_HINT = 'run again with --app-only to install the app alone (demo mode, or a remote GPU with --proxy-url)';

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const atLeast = (version: number[], min: number[]) => version[0]! > min[0]! || (version[0] === min[0] && version[1]! >= min[1]!);
const inRange = (version: number[]) => atLeast(version, PYTHON_RANGE.min) && !atLeast(version, [PYTHON_RANGE.max[0], PYTHON_RANGE.max[1] + 1]);

export function pickGpu(gpus: Gpu[]): Gpu | null {
  return gpus.reduce<Gpu | null>((best, gpu) => (!best || gpu.vramMiB > best.vramMiB ? gpu : best), null);
}

/** The first Python of the probe order (3.12, 3.13, 3.11, 3.10) that is in range and can make a venv. */
export function pickPython(pythons: PythonInfo[]): PythonInfo | null {
  return pythons.find((python) => inRange(python.version) && python.hasVenv) ?? null;
}

export function pickTorch(driverCuda: [number, number] | null, versions: Versions): TorchPin | null {
  if (!driverCuda) return null;
  for (const pin of [versions.torch, versions.torchFallback]) if (atLeast(driverCuda, pin.minDriverCuda)) return pin;
  return null;
}

const FIXES: Record<'node' | 'git' | 'python' | 'venv' | 'ffmpeg', Record<Os, string>> = {
  node: { windows: 'winget install OpenJS.NodeJS.LTS', linux: 'install Node.js 22.18 or newer from https://nodejs.org (or: nvm install 22)' },
  git: { windows: 'winget install Git.Git', linux: 'sudo apt install git' },
  python: {
    windows: 'winget install Python.Python.3.12 (and turn off the "python.exe" App execution alias in Windows settings if it opens the Microsoft Store)',
    linux: 'sudo apt install python3.12-venv (it brings python3.12 along)',
  },
  venv: { windows: 'reinstall Python 3.12 with: winget install Python.Python.3.12', linux: 'sudo apt install python3.12-venv' },
  ffmpeg: { windows: 'winget install Gyan.FFmpeg, then open a new terminal', linux: 'sudo apt install ffmpeg' },
};

type Context = { mode: Mode; versions: Versions; ports: Ports; ownPorts: number[]; need: { installDir: number; repo: number }; ignoreVram: boolean };

export function evaluate(facts: MachineFacts, ctx: Context): Check[] {
  const os: Os = facts.os ?? 'linux';
  const full = ctx.mode === 'full';
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  if (!facts.os) {
    add({
      id: 'os',
      severity: 'fail',
      message: `${facts.platform} is not supported: Montagio installs on Windows or Linux, with an NVIDIA GPU`,
      fix: 'on a Mac, use the demo link instead',
    });
  } else if (full && facts.arch !== 'x64') {
    add({ id: 'os', severity: 'fail', message: `${facts.arch} is not supported: the full install needs an x64 machine`, fix: APP_ONLY_HINT });
  } else {
    add({ id: 'os', severity: 'ok', message: `${facts.os} ${facts.arch}` });
  }

  const node = facts.node.join('.');
  add(
    atLeast(facts.node, MIN_NODE)
      ? { id: 'node', severity: 'ok', message: `Node.js ${node}` }
      : { id: 'node', severity: 'fail', message: `Node.js ${node} is too old: Montagio needs 22.18 or newer`, fix: FIXES.node[os] },
  );

  if (full) {
    add(facts.git ? { id: 'git', severity: 'ok', message: 'git' } : { id: 'git', severity: 'fail', message: 'git is missing', fix: FIXES.git[os] });

    const python = pickPython(facts.pythons);
    const inRangeNoVenv = facts.pythons.find((p) => inRange(p.version) && !p.hasVenv);
    const found = facts.pythons.map((p) => p.version.join('.')).join(', ') || 'none';
    if (python) add({ id: 'python', severity: 'ok', message: `Python ${python.version.join('.')} (${python.command.join(' ')})` });
    else if (inRangeNoVenv)
      add({ id: 'python', severity: 'fail', message: `Python ${inRangeNoVenv.version.join('.')} cannot make a venv (no venv or ensurepip module)`, fix: FIXES.venv[os] });
    else add({ id: 'python', severity: 'fail', message: `no Python 3.10 to 3.13 found (found: ${found})`, fix: FIXES.python[os] });
  }

  add(
    facts.ffmpeg && facts.ffprobe
      ? { id: 'ffmpeg', severity: 'ok', message: 'FFmpeg and ffprobe' }
      : { id: 'ffmpeg', severity: 'fail', message: `${facts.ffmpeg ? 'ffprobe' : 'FFmpeg'} is missing: the app needs both to tag clips and cut films`, fix: FIXES.ffmpeg[os] },
  );

  if (full) {
    const gpu = pickGpu(facts.gpus);
    if (!gpu) {
      add({ id: 'gpu', severity: 'fail', message: 'no NVIDIA GPU found (nvidia-smi did not answer)', fix: APP_ONLY_HINT });
    } else {
      const label = `${gpu.name}, ${gib(gpu.vramMiB * 1024 ** 2)} of VRAM`;
      if (gpu.vramMiB >= MIN_VRAM_MIB) add({ id: 'gpu', severity: 'ok', message: label });
      else if (ctx.ignoreVram)
        add({ id: 'gpu', severity: 'warn', message: `${label}: under 22 GiB, renders may run out of memory (--ignore-vram)` });
      else
        add({
          id: 'gpu',
          severity: 'fail',
          message: `${label}: the video models need a 24 GB card`,
          fix: `${APP_ONLY_HINT}; or --ignore-vram to try anyway`,
        });

      const torch = pickTorch(facts.driverCuda, ctx.versions);
      const cuda = facts.driverCuda?.join('.') ?? 'unknown';
      if (!torch)
        add({
          id: 'driver',
          severity: 'fail',
          message: `the driver supports CUDA ${cuda}: PyTorch needs 12.8 or newer`,
          fix: 'update the NVIDIA driver (R580 or newer for CUDA 13.0)',
        });
      else if (torch === ctx.versions.torch) add({ id: 'driver', severity: 'ok', message: `driver ${gpu.driver}, CUDA ${cuda}: torch ${torch.torch}+${torch.cuda}` });
      else
        add({
          id: 'driver',
          severity: 'warn',
          message: `driver ${gpu.driver} stops at CUDA ${cuda}: falling back to torch ${torch.torch}+${torch.cuda}; a driver R580 or newer gets the CUDA 13.0 build ComfyUI prefers`,
        });
    }
  }

  const short: string[] = [];
  if (facts.sameVolume) {
    // One drive holds both: each need keeps its own margin, 2 GiB more than either alone.
    const both = ctx.need.installDir + ctx.need.repo;
    if (facts.freeBytes.installDir < both) short.push(`${gib(facts.freeBytes.installDir)} free on the drive of the install folder and the repository, ${gib(both)} needed for both`);
  } else {
    if (facts.freeBytes.installDir < ctx.need.installDir) short.push(`${gib(facts.freeBytes.installDir)} free for the install folder, ${gib(ctx.need.installDir)} needed`);
    if (facts.freeBytes.repo < ctx.need.repo) short.push(`${gib(facts.freeBytes.repo)} free beside the repository, ${gib(ctx.need.repo)} needed`);
  }
  add(
    short.length === 0
      ? { id: 'disk', severity: 'ok', message: `${gib(facts.freeBytes.installDir)} free for the install folder` }
      : { id: 'disk', severity: 'fail', message: short.join('; '), fix: 'free some space, or install on another drive with --dir <folder>' },
  );

  if (full) {
    add(
      facts.ramBytes >= RAM_WARN_BYTES
        ? { id: 'ram', severity: 'ok', message: `${gib(facts.ramBytes)} of RAM` }
        : { id: 'ram', severity: 'warn', message: `${gib(facts.ramBytes)} of RAM: 32 GB or more is recommended, ComfyUI swaps the 14B models through RAM` },
    );
  }

  const wanted: (keyof Ports)[] = full ? ['comfy', 'proxy', 'app'] : ['app'];
  // A port saved by an earlier install and a new option can give one port to two services.
  const firstOn = (name: keyof Ports) => wanted.find((other) => ctx.ports[other] === ctx.ports[name])!;
  const shared = wanted.filter((name) => firstOn(name) !== name);
  const taken = wanted.filter((name) => !shared.includes(name) && facts.busyPorts.includes(ctx.ports[name]) && !ctx.ownPorts.includes(ctx.ports[name]));
  const moves = [...shared, ...taken].map((name) => `${PORT_OPTIONS[name].option} <port>`).join(', ');
  add(
    shared.length === 0 && taken.length === 0
      ? { id: 'ports', severity: 'ok', message: `${wanted.length > 1 ? 'ports' : 'port'} ${wanted.map((name) => ctx.ports[name]).join(', ')}` }
      : {
          id: 'ports',
          severity: 'fail',
          message: [
            ...shared.map((name) => `port ${ctx.ports[name]} is given to both ${PORT_OPTIONS[firstOn(name)].label} and ${PORT_OPTIONS[name].label}`),
            ...taken.map((name) => `port ${ctx.ports[name]} (${PORT_OPTIONS[name].label}) is already in use`),
          ].join('; '),
          fix: taken.length > 0 ? `stop the program that uses it, or pick another port with ${moves}` : `pick another port with ${moves}`,
        },
  );

  return checks;
}

export function decide(checks: Check[], mode: Mode): Decision {
  const fails = checks.filter((check) => check.severity === 'fail');
  if (fails.length === 0) return { kind: 'proceed', mode };
  const gpu = fails.find((check) => check.id === 'gpu');
  // The app alone is re-checked on its own terms once accepted; only what it needs as well rules it out here.
  if (mode === 'full' && gpu && !fails.some((check) => BOTH_MODES.includes(check.id))) return { kind: 'offer-app-only', reason: gpu.message };
  return { kind: 'stop' };
}
