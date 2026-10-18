/** Where an install lives on each system, and the paths inside it. */
import { posix, win32 } from 'node:path';

export type Os = 'windows' | 'linux';

export type Layout = {
  dir: string;
  comfyDir: string;
  /** A clone goes here first and is renamed to comfyDir once checked, so an interrupted clone never looks complete. */
  comfyTmp: string;
  comfyVenv: string;
  proxyVenv: string;
  comfyPython: string;
  proxyPython: string;
  proxyExe: string;
  modelsDir: string;
  /** ComfyUI/custom_nodes/montagio, a link (a junction on Windows) to the repository's comfy-nodes. */
  packLink: string;
  logsDir: string;
  /** fetch-weights writes weights-report.json here. */
  weightsOut: string;
  runDir: string;
  cacheDir: string;
  statePath: string;
};

export function osOf(platform: string): Os | null {
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  return null;
}

export function pathFor(os: Os): typeof posix {
  return os === 'windows' ? win32 : posix;
}

export function defaultInstallDir(os: Os, env: Record<string, string | undefined>, home: string): string {
  if (env.MONTAGIO_HOME) return env.MONTAGIO_HOME;
  const path = pathFor(os);
  if (os === 'windows') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Montagio');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'montagio');
}

export function layout(dir: string, os: Os): Layout {
  const { join } = pathFor(os);
  const bin = (venv: string, name: string) => (os === 'windows' ? join(venv, 'Scripts', `${name}.exe`) : join(venv, 'bin', name));
  const comfyDir = join(dir, 'ComfyUI');
  const comfyVenv = join(dir, 'venvs', 'comfyui');
  const proxyVenv = join(dir, 'venvs', 'comfy-api-proxy');
  const logsDir = join(dir, 'logs');
  return {
    dir,
    comfyDir,
    comfyTmp: join(dir, 'ComfyUI.tmp'),
    comfyVenv,
    proxyVenv,
    comfyPython: bin(comfyVenv, 'python'),
    proxyPython: bin(proxyVenv, 'python'),
    proxyExe: bin(proxyVenv, 'comfy-api-proxy'),
    modelsDir: join(comfyDir, 'models'),
    packLink: join(comfyDir, 'custom_nodes', 'montagio'),
    logsDir,
    weightsOut: join(logsDir, 'weights'),
    runDir: join(dir, 'run'),
    cacheDir: join(dir, 'cache'),
    statePath: join(dir, 'install-state.json'),
  };
}
