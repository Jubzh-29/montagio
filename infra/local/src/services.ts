/**
 * Start, stop and watch the three Montagio services, the way
 * infra/runpod/bootstrap.sh does on the GPU pod: ComfyUI with
 * --disable-partner-nodes on 127.0.0.1, comfy-api-proxy in front of it, then
 * the app (next start) on 127.0.0.1 with the local backend.
 *
 * A pid file alone proves nothing after a reboot: a process is only ever
 * stopped when its command line names this install (its marker).
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ports } from './checks.ts';
import { nextBin, type Capture } from './exec.ts';
import type { Layout, Os } from './platform.ts';
import { portBusy } from './probe.ts';
import type { InstallState } from './state.ts';

export type ServiceName = 'comfyui' | 'proxy' | 'app';

export type ServiceSpec = {
  name: ServiceName;
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  health: string;
  timeoutMs: number;
  /** A string the command line of this service always holds, and no other program's. */
  marker: string;
  port: number;
};

export type ServiceContext = {
  os: Os;
  layout: Layout;
  repoRoot: string;
  state: InstallState;
  capture: Capture;
  log: (line: string) => void;
  /** Tests only: stand-in services. */
  specs?: ServiceSpec[];
  openBrowser?: (url: string) => void;
};

/** The core and Montagio nodes the workflows need (the same list as bootstrap.sh). */
export const NEEDED_NODES = [
  'WanCameraEmbedding',
  'WanCameraImageToVideo',
  'Wan22ImageToVideoLatent',
  'CreateVideo',
  'SaveVideo',
  'UNETLoader',
  'MontagioCameraEmbedding',
];

const PORT_OPTION: Record<ServiceName, string> = { comfyui: '--comfy-port', proxy: '--proxy-port', app: '--app-port' };
const STOP_ORDER: ServiceName[] = ['app', 'proxy', 'comfyui'];

type ObjectInfo = Record<string, { api_node?: boolean; python_module?: string }>;

export function partnerNodes(info: ObjectInfo): string[] {
  return Object.entries(info)
    .filter(([, node]) => node.api_node || String(node.python_module ?? '').startsWith('comfy_api_nodes'))
    .map(([name]) => name)
    .sort();
}

export function missingNodes(info: ObjectInfo): string[] {
  return NEEDED_NODES.filter((name) => !(name in info));
}

export function serviceSpecs(input: {
  os: Os;
  layout: Layout;
  repoRoot: string;
  state: InstallState;
  nodePath: string;
  baseEnv: NodeJS.ProcessEnv;
  extraComfyArgs: string[];
}): ServiceSpec[] {
  const { layout: L, state } = input;
  const ports: Ports = state.ports;
  const env: NodeJS.ProcessEnv = { ...input.baseEnv };
  delete env.COMFY_API_KEY;
  const local = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

  const appEnv: NodeJS.ProcessEnv = { ...env, NEXT_TELEMETRY_DISABLED: '1', MONTAGIO_ROOT: input.repoRoot };
  delete appEnv.COMFY_BASE_URL;
  if (state.mode === 'full') Object.assign(appEnv, { MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: local(ports.proxy, '') });
  else if (state.proxyUrl) Object.assign(appEnv, { MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: state.proxyUrl });
  else appEnv.MONTAGIO_BACKEND = 'demo';

  const next = nextBin(input.repoRoot);
  const app: ServiceSpec = {
    name: 'app',
    cmd: input.nodePath,
    args: [next, 'start', '-H', '127.0.0.1', '-p', String(ports.app)],
    cwd: join(input.repoRoot, 'apps', 'web'),
    env: appEnv,
    health: local(ports.app, '/'),
    timeoutMs: 90_000,
    marker: next,
    port: ports.app,
  };
  if (state.mode !== 'full') return [app];

  const gpu = state.gpuIndex && state.gpuIndex > 0 ? ['--cuda-device', String(state.gpuIndex)] : [];
  return [
    {
      name: 'comfyui',
      cmd: L.comfyPython,
      args: ['main.py', '--listen', '127.0.0.1', '--port', String(ports.comfy), '--disable-partner-nodes', ...gpu, ...input.extraComfyArgs],
      cwd: L.comfyDir,
      env,
      health: local(ports.comfy, '/system_stats'),
      timeoutMs: 300_000,
      marker: L.comfyVenv,
      port: ports.comfy,
    },
    {
      name: 'proxy',
      cmd: L.proxyExe,
      args: ['run', '--comfyui', local(ports.comfy, ''), '--host', '127.0.0.1', '--port', String(ports.proxy), '--comfyui-base-dir', L.comfyDir],
      cwd: L.dir,
      env,
      health: local(ports.proxy, '/api/v2/health'),
      timeoutMs: 60_000,
      marker: L.proxyVenv,
      port: ports.proxy,
    },
    app,
  ];
}

function realSpecs(ctx: ServiceContext, state = ctx.state): ServiceSpec[] {
  return (
    ctx.specs ??
    serviceSpecs({
      os: ctx.os,
      layout: ctx.layout,
      repoRoot: ctx.repoRoot,
      state,
      nodePath: process.execPath,
      baseEnv: process.env,
      extraComfyArgs: (process.env.MONTAGIO_COMFYUI_ARGS ?? '').split(/\s+/).filter(Boolean),
    })
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True only when the command line of `pid` holds `marker` (case-insensitive on Windows). */
export async function isOurs(pid: number, marker: string, os: Os, capture: Capture): Promise<boolean> {
  if (!alive(pid)) return false;
  if (os === 'linux') {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').includes(marker);
    } catch {
      return false;
    }
  }
  const answer = await capture('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').CommandLine`,
  ]);
  return answer.code === 0 && answer.stdout.toLowerCase().includes(marker.toLowerCase());
}

export async function waitHttp(url: string, timeoutMs: number, isAlive: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      if (res.ok) return;
    } catch {
      // not answering yet
    }
    if (!isAlive()) throw new Error('exited during startup');
    if (Date.now() > deadline) throw new Error(`did not answer on ${url} after ${Math.round(timeoutMs / 1000)} s`);
    await sleep(500);
  }
}

const pidFile = (ctx: ServiceContext, name: ServiceName) => join(ctx.layout.runDir, `${name}.pid`);

function readPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function killTree(pid: number, os: Os, capture: Capture): Promise<void> {
  if (os === 'windows') {
    // The python.exe of a venv and pip's .exe launchers start the real process as a child: /T takes the tree.
    await capture('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  }
  for (let waited = 0; waited < 10_000 && alive(pid); waited += 250) await sleep(250);
  if (alive(pid) && os === 'linux') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

/** Ports of the services running now from this install. */
export async function runningPorts(ctx: ServiceContext): Promise<number[]> {
  const ports: number[] = [];
  for (const spec of realSpecs(ctx, { ...ctx.state, mode: 'full' })) {
    const pid = readPid(pidFile(ctx, spec.name));
    if (pid && (await isOurs(pid, spec.marker, ctx.os, ctx.capture))) ports.push(spec.port);
  }
  return ports;
}

export async function stopAll(ctx: ServiceContext): Promise<void> {
  // Every service, whatever the mode: an install that went from full to app-only may leave ComfyUI running.
  const specs = realSpecs(ctx, { ...ctx.state, mode: 'full' });
  for (const name of STOP_ORDER) {
    const spec = specs.find((s) => s.name === name);
    const path = pidFile(ctx, name);
    const pid = readPid(path);
    if (!pid || !spec) {
      rmSync(path, { force: true });
      continue;
    }
    if (await isOurs(pid, spec.marker, ctx.os, ctx.capture)) {
      ctx.log(`stopping ${name} (pid ${pid})`);
      await killTree(pid, ctx.os, ctx.capture);
    } else if (alive(pid)) {
      ctx.log(`${name}: pid ${pid} is another program now (stale pid file), left alone`);
    }
    rmSync(path, { force: true });
  }
}

function tail(path: string, lines = 30): string {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function openInBrowser(os: Os, url: string, log: (line: string) => void): void {
  const child =
    os === 'windows'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => log(`open ${url} in your browser`));
  child.unref();
}

export async function startAll(ctx: ServiceContext, opts: { browser: boolean }): Promise<number> {
  if (!ctx.state.mode) {
    ctx.log(`Montagio is not installed in ${ctx.layout.dir}: run the install command first`);
    return 1;
  }
  const specs = realSpecs(ctx);
  mkdirSync(ctx.layout.runDir, { recursive: true });
  mkdirSync(ctx.layout.logsDir, { recursive: true });

  // Which services already run from this install, and whether a port is taken by another program, before starting anything.
  const ours = new Map<ServiceName, number>();
  for (const spec of specs) {
    const pid = readPid(pidFile(ctx, spec.name));
    if (pid && (await isOurs(pid, spec.marker, ctx.os, ctx.capture))) ours.set(spec.name, pid);
    else rmSync(pidFile(ctx, spec.name), { force: true });
  }
  for (const spec of specs) {
    if (!ours.has(spec.name) && (await portBusy(spec.port))) {
      ctx.log(
        `error: port ${spec.port} (${spec.name}) is used by another program: stop it, or install again with ${PORT_OPTION[spec.name]} <port>`,
      );
      return 1;
    }
  }

  const fail = async (message: string) => {
    ctx.log(`error: ${message}`);
    await stopAll(ctx);
    return 1;
  };

  for (const spec of specs) {
    const log = join(ctx.layout.logsDir, `${spec.name}.log`);
    let pid = ours.get(spec.name);
    if (pid) {
      ctx.log(`${spec.name} already running (pid ${pid})`);
    } else {
      ctx.log(`starting ${spec.name} on 127.0.0.1:${spec.port}`);
      if (!existsSync(spec.cwd)) return fail(`${spec.cwd} is missing: run the install command again`);
      const out = openSync(log, 'a');
      const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
      closeSync(out);
      const spawned = await new Promise<boolean>((resolve) => {
        child.once('spawn', () => resolve(true));
        child.once('error', () => resolve(false));
      });
      if (!spawned || !child.pid) return fail(`cannot start ${spec.name} (${spec.cmd}): run the install command again`);
      child.unref();
      pid = child.pid;
      writeFileSync(pidFile(ctx, spec.name), String(pid));
    }
    const running = pid;
    try {
      await waitHttp(spec.health, spec.timeoutMs, () => alive(running));
    } catch (error) {
      const last = tail(log);
      if (last) ctx.log(last);
      return fail(`${spec.name} ${(error as Error).message} (full log: ${log})`);
    }

    if (spec.name === 'comfyui') {
      const info = (await (await fetch(`http://127.0.0.1:${spec.port}/object_info`)).json()) as ObjectInfo;
      const partners = partnerNodes(info);
      ctx.log(`${Object.keys(info).length} node classes loaded, ${partners.length} partner node(s)`);
      if (partners.length > 0) {
        return fail(`partner nodes are loaded (${partners.slice(0, 20).join(', ')}): ComfyUI must run with --disable-partner-nodes`);
      }
      const missing = missingNodes(info);
      if (missing.length > 0) ctx.log(`warning: nodes missing: ${missing.join(', ')}`);
      if (missing.includes('MontagioCameraEmbedding')) {
        ctx.log(`warning: the Montagio node pack did not load: look for its import error in ${log}, then install again`);
      }
    }
  }

  const app = specs.find((s) => s.name === 'app')!;
  const url = `http://127.0.0.1:${app.port}`;
  ctx.log(`Montagio is ready: ${url}`);
  if (ctx.state.mode === 'full') ctx.log(`ComfyUI: http://127.0.0.1:${ctx.state.ports.comfy}   logs: ${ctx.layout.logsDir}`);
  if (opts.browser) (ctx.openBrowser ?? ((u: string) => openInBrowser(ctx.os, u, ctx.log)))(url);
  return 0;
}

export async function status(ctx: ServiceContext): Promise<string> {
  const lines = [`install folder: ${ctx.layout.dir}`, `mode: ${ctx.state.mode ?? 'not installed'}`];
  for (const spec of realSpecs(ctx, { ...ctx.state, mode: 'full' })) {
    if (ctx.state.mode !== 'full' && spec.name !== 'app') continue;
    const pid = readPid(pidFile(ctx, spec.name));
    const state = pid && (await isOurs(pid, spec.marker, ctx.os, ctx.capture)) ? `running (pid ${pid})` : 'stopped';
    lines.push(`${spec.name.padEnd(8)} ${state.padEnd(20)} http://127.0.0.1:${spec.port}`);
  }
  lines.push(`logs: ${ctx.layout.logsDir}`);
  return lines.join('\n');
}
