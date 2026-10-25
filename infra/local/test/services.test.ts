import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORTS } from '../src/checks.ts';
import { capture } from '../src/exec.ts';
import { layout, osOf } from '../src/platform.ts';
import {
  comfyExtraArgs,
  isOurs,
  missingNodes,
  NEEDED_NODES,
  partnerNodes,
  runningPorts,
  serviceSpecs,
  startAll,
  status,
  stopAll,
  type ServiceContext,
  type ServiceSpec,
} from '../src/services.ts';
import { emptyState, type InstallState } from '../src/state.ts';

const os = osOf(process.platform)!;
const realRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(realRoot, 'infra', 'runpod', 'test', 'fixtures', 'object_info-v0.41.0.json'), 'utf8')) as Record<
  string,
  { api_node?: boolean; python_module?: string }
>;

// --- pure parts ---------------------------------------------------------

const L = layout(os === 'windows' ? 'C:\\S R' : '/s r', os);
const full: InstallState = { ...emptyState(), mode: 'full', gpuIndex: 0 };
const specsOf = (state: InstallState, baseEnv: NodeJS.ProcessEnv = {}, extra: string[] = []) =>
  serviceSpecs({ os, layout: L, repoRoot: '/repo dir', state, nodePath: '/bin/node', baseEnv, extraComfyArgs: extra });

test('ComfyUI listens on 127.0.0.1 with partner nodes disabled', () => {
  const comfy = specsOf(full).find((s) => s.name === 'comfyui')!;
  expect(comfy.cmd).toBe(L.comfyPython);
  expect(comfy.args).toEqual(['main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-partner-nodes']);
  expect(comfy.args.join(' ')).not.toContain('0.0.0.0');
  expect(comfy.health).toBe('http://127.0.0.1:8188/system_stats');
  expect(specsOf({ ...full, gpuIndex: 1 }, {}, ['--lowvram']).find((s) => s.name === 'comfyui')!.args.slice(-3)).toEqual(['--cuda-device', '1', '--lowvram']);
});

test('MONTAGIO_COMFYUI_ARGS adds arguments but cannot move ComfyUI off 127.0.0.1', () => {
  expect(comfyExtraArgs(undefined)).toEqual([]);
  expect(comfyExtraArgs(' --lowvram  --preview-method auto ')).toEqual(['--lowvram', '--preview-method', 'auto']);
  expect(() => comfyExtraArgs('--listen 0.0.0.0')).toThrow(/--listen/);
  expect(() => comfyExtraArgs('--lowvram --port=9000')).toThrow(/--port/);
  // ComfyUI's argparse takes an unambiguous abbreviation of an option.
  expect(() => comfyExtraArgs('--liste 0.0.0.0')).toThrow(/--liste/);
  expect(() => comfyExtraArgs('--listen')).toThrow(/127\.0\.0\.1/);
});

test('the Python services write their logs unbuffered, so a crash keeps its last lines', () => {
  const specs = specsOf(full);
  for (const name of ['comfyui', 'proxy']) expect(specs.find((s) => s.name === name)!.env.PYTHONUNBUFFERED).toBe('1');
});

test('CUDA numbers the GPUs as nvidia-smi does, so --cuda-device picks the card the checks chose', () => {
  // CUDA's default order is fastest first; nvidia-smi's (and pickGpu's) is the PCI bus.
  expect(specsOf({ ...full, gpuIndex: 1 }).find((s) => s.name === 'comfyui')!.env.CUDA_DEVICE_ORDER).toBe('PCI_BUS_ID');
});

test('the proxy and the app follow the install ports', () => {
  const specs = specsOf({ ...full, ports: { comfy: 8288, proxy: 8289, app: 3300 } });
  const proxy = specs.find((s) => s.name === 'proxy')!;
  expect(proxy.args).toEqual(['run', '--comfyui', 'http://127.0.0.1:8288', '--host', '127.0.0.1', '--port', '8289', '--comfyui-base-dir', L.comfyDir]);
  const app = specs.find((s) => s.name === 'app')!;
  expect(app.args.slice(1)).toEqual(['start', '-H', '127.0.0.1', '-p', '3300']);
  expect(app.env.COMFY_BASE_URL).toBe('http://127.0.0.1:8289');
});

test('the app runs the local backend, without any Comfy key', () => {
  const app = specsOf(full, { COMFY_API_KEY: 'secret', PATH: '/bin' }).find((s) => s.name === 'app')!;
  expect(app.env).toMatchObject({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: 'http://127.0.0.1:8189', NEXT_TELEMETRY_DISABLED: '1', MONTAGIO_ROOT: '/repo dir', PATH: '/bin' });
  expect(app.env.COMFY_API_KEY).toBeUndefined();
  expect(specsOf(full).map((s) => s.name)).toEqual(['comfyui', 'proxy', 'app']);
});

test('on Windows, no Comfy key or stale base URL reaches the services, whatever the case of their names', () => {
  const W = layout('C:\\S R', 'windows');
  const specs = serviceSpecs({
    os: 'windows',
    layout: W,
    repoRoot: 'C:\\repo dir',
    state: full,
    nodePath: 'C:\\node.exe',
    baseEnv: { Comfy_Api_Key: 'secret', comfy_base_url: 'http://stale:1', Path: 'C:\\bin' },
    extraComfyArgs: [],
  });
  for (const spec of specs) {
    const names = Object.keys(spec.env).map((name) => name.toUpperCase());
    expect(names).not.toContain('COMFY_API_KEY');
    expect(names.filter((name) => name === 'COMFY_BASE_URL').length).toBeLessThanOrEqual(1);
  }
  expect(specs.find((s) => s.name === 'app')!.env.COMFY_BASE_URL).toBe('http://127.0.0.1:8189');
});

test('a full install starts the app with the extensions it installed, or none', () => {
  const app = (state: InstallState, baseEnv: NodeJS.ProcessEnv = {}) => specsOf(state, baseEnv).find((s) => s.name === 'app')!;
  expect(app({ ...full, extensions: ['edit', 'effects'] }, { MONTAGIO_EXTENSIONS: 'all' }).env.MONTAGIO_EXTENSIONS).toBe('edit,effects');
  expect(app({ ...full, extensions: [] }).env.MONTAGIO_EXTENSIONS).toBe('none');
});

test('the 12 GB profile reaches the app as MONTAGIO_VRAM_PROFILE', () => {
  const app = (state: InstallState) => specsOf(state).find((s) => s.name === 'app')!;
  expect(app({ ...full, vramProfile: '12gb' }).env.MONTAGIO_VRAM_PROFILE).toBe('12gb');
  expect(app({ ...full, vramProfile: 'standard' }).env.MONTAGIO_VRAM_PROFILE).toBeUndefined();
  expect(app({ ...full, mode: 'app-only', vramProfile: '12gb' }).env.MONTAGIO_VRAM_PROFILE).toBeUndefined();
});

test('the app alone, or a state from before the extensions were recorded, keeps the user MONTAGIO_EXTENSIONS', () => {
  const app = (state: InstallState) => specsOf(state, { MONTAGIO_EXTENSIONS: 'all' }).find((s) => s.name === 'app')!;
  expect(app({ ...full, mode: 'app-only', extensions: ['edit'] }).env.MONTAGIO_EXTENSIONS).toBe('all');
  expect(app({ ...full, extensions: null }).env.MONTAGIO_EXTENSIONS).toBe('all');
});

test('the app alone runs the demo, or a remote proxy', () => {
  const demo = specsOf({ ...full, mode: 'app-only' }, { COMFY_BASE_URL: 'http://stale:1' });
  expect(demo.map((s) => s.name)).toEqual(['app']);
  expect(demo[0]!.env.MONTAGIO_BACKEND).toBe('demo');
  expect(demo[0]!.env.COMFY_BASE_URL).toBeUndefined();
  const remote = specsOf({ ...full, mode: 'app-only', proxyUrl: 'http://127.0.0.1:9189' });
  expect(remote[0]!.env).toMatchObject({ MONTAGIO_BACKEND: 'local', COMFY_BASE_URL: 'http://127.0.0.1:9189' });
});

test('partner nodes and missing nodes are read from /object_info', () => {
  expect(partnerNodes(fixture)).toEqual([]);
  expect(missingNodes(fixture)).toEqual([]);
  expect(partnerNodes({ X: { api_node: true }, Y: { python_module: 'comfy_api_nodes.foo' }, Z: { python_module: 'nodes' } })).toEqual(['X', 'Y']);
  expect(missingNodes({})).toEqual(NEEDED_NODES);
  expect(NEEDED_NODES).toContain('MontagioCameraEmbedding');
});

// --- real processes -----------------------------------------------------

let base: string;
let fake: string;
const strays: ChildProcess[] = [];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'montagio services '));
  fake = join(base, 'fake service.mjs');
  // A stand-in service: answers 200 on every path, and /object_info with the JSON file it is given.
  writeFileSync(
    fake,
    `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const [port, info] = process.argv.slice(2);
createServer((req, res) => {
  if (req.url === '/object_info' && info) { res.setHeader('content-type', 'application/json'); res.end(readFileSync(info)); return; }
  res.end('{"status":"healthy"}');
}).listen(Number(port), '127.0.0.1');
`,
  );
});
afterEach(() => {
  for (const child of strays) child.kill();
  strays.length = 0;
  rmSync(base, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fakeContext(opts: { partner?: boolean; dying?: 'proxy'; brokenInfo?: boolean } = {}) {
  const dir = join(base, 'install dir');
  const l = layout(dir, os);
  const ports = { comfy: await freePort(), proxy: await freePort(), app: await freePort() };
  const info = join(base, 'object info.json');
  writeFileSync(info, opts.brokenInfo ? '{"cut short' : JSON.stringify(opts.partner ? { ...fixture, PartnerThing: { api_node: true } } : fixture));
  const spec = (name: ServiceSpec['name'], port: number, args: string[] = []): ServiceSpec => ({
    name,
    cmd: process.execPath,
    args: [fake, String(port), ...args],
    cwd: base,
    env: process.env,
    health: `http://127.0.0.1:${port}/`,
    timeoutMs: 20_000,
    marker: fake,
    port,
  });
  const specs = [spec('comfyui', ports.comfy, [info]), spec('proxy', ports.proxy), spec('app', ports.app)];
  if (opts.dying) specs[1] = { ...specs[1]!, args: ['-e', 'process.exit(3)'] };
  const lines: string[] = [];
  const ctx: ServiceContext = {
    os,
    layout: l,
    repoRoot: realRoot,
    state: { ...emptyState(), mode: 'full', ports },
    capture,
    log: (line) => lines.push(line),
    specs,
    openBrowser: () => undefined,
  };
  const pid = (name: string) => Number(readFileSync(join(l.runDir, `${name}.pid`), 'utf8'));
  return { ctx, l, ports, lines, pid };
}

test('start runs the three services, status sees them, stop ends them', async () => {
  const { ctx, l, ports, pid } = await fakeContext();
  expect(await startAll(ctx, { browser: false })).toBe(0);
  const pids = ['comfyui', 'proxy', 'app'].map(pid);
  expect(pids.every(alive)).toBe(true);
  expect((await runningPorts(ctx)).sort()).toEqual([ports.comfy, ports.proxy, ports.app].sort());
  expect(await status(ctx)).toMatch(/comfyui\s+running/);
  await stopAll(ctx);
  expect(pids.some(alive)).toBe(false);
  expect(['comfyui', 'proxy', 'app'].some((name) => existsSync(join(l.runDir, `${name}.pid`)))).toBe(false);
  expect(await status(ctx)).toMatch(/app\s+stopped/);
}, 60_000);

test('start twice reuses what runs', async () => {
  const { ctx, pid, lines } = await fakeContext();
  await startAll(ctx, { browser: false });
  const first = pid('app');
  expect(await startAll(ctx, { browser: false })).toBe(0);
  expect(pid('app')).toBe(first);
  expect(lines.join('\n')).toContain('already running');
  await stopAll(ctx);
}, 60_000);

test('stop leaves alone a process whose command line is not ours', async () => {
  const { ctx, l } = await fakeContext();
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  strays.push(other);
  mkdirSync(l.runDir, { recursive: true });
  writeFileSync(join(l.runDir, 'app.pid'), String(other.pid));
  expect(await isOurs(other.pid!, ctx.specs![2]!.marker, os, capture)).toBe(false);
  await stopAll(ctx);
  expect(alive(other.pid!)).toBe(true);
  expect(existsSync(join(l.runDir, 'app.pid'))).toBe(false);
}, 30_000);

test('start ignores a stale pid file: a dead pid, or a pid that is another program now', async () => {
  const { ctx, l, lines, pid } = await fakeContext();
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  strays.push(other);
  await new Promise((resolve) => other.once('spawn', resolve));
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => dead.once('exit', resolve));
  mkdirSync(l.runDir, { recursive: true });
  writeFileSync(join(l.runDir, 'app.pid'), String(other.pid));
  writeFileSync(join(l.runDir, 'proxy.pid'), String(dead.pid));
  try {
    expect(await startAll(ctx, { browser: false })).toBe(0);
    expect(lines.join('\n')).not.toContain('already running');
    expect(pid('app')).not.toBe(other.pid);
    expect(pid('proxy')).not.toBe(dead.pid);
  } finally {
    await stopAll(ctx);
  }
  expect(alive(other.pid!)).toBe(true);
}, 60_000);

test('isOurs reads a command line that holds non-ASCII characters', async () => {
  // A Windows profile such as C:\Users\Jérôme puts accents in every marker.
  const marker = 'montagio-marker-Jérôme-Ünïcode';
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore' });
  strays.push(child);
  await new Promise((resolve) => child.once('spawn', resolve));
  expect(await isOurs(child.pid!, marker, os, capture)).toBe(true);
}, 30_000);

test.runIf(os === 'windows')('stop keeps the pid file of a process whose command line it cannot read', async () => {
  const { ctx, l, lines } = await fakeContext();
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  strays.push(other);
  mkdirSync(l.runDir, { recursive: true });
  writeFileSync(join(l.runDir, 'app.pid'), String(other.pid));
  // What Get-CimInstance gives for a process started from an elevated terminal: no command line.
  await stopAll({ ...ctx, capture: async () => ({ code: 0, stdout: '\r\n', stderr: '' }) });
  expect(alive(other.pid!)).toBe(true);
  expect(existsSync(join(l.runDir, 'app.pid'))).toBe(true);
  expect(lines.join('\n')).toContain('cannot read');
}, 30_000);

test('start refuses a port held by a foreign process, and starts nothing', async () => {
  const { ctx, l, ports, lines } = await fakeContext();
  const squatter: Server = createServer().listen(ports.app, '127.0.0.1');
  await new Promise((resolve) => squatter.once('listening', resolve));
  try {
    expect(await startAll(ctx, { browser: false })).toBe(1);
    expect(lines.join('\n')).toContain(String(ports.app));
    expect(lines.join('\n')).toContain('--app-port');
    expect(existsSync(join(l.runDir, 'comfyui.pid'))).toBe(false);
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
  }
}, 30_000);

test('a service that dies while starting stops the start at once and names its log', async () => {
  const { ctx, l, lines, pid } = await fakeContext({ dying: 'proxy' });
  const started = Date.now();
  expect(await startAll(ctx, { browser: false })).toBe(1);
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(lines.join('\n')).toContain(join(l.logsDir, 'proxy.log'));
  expect(lines.join('\n')).toContain('exited during startup with code 3');
  // What had started is stopped again.
  expect(existsSync(join(l.runDir, 'comfyui.pid'))).toBe(false);
  void pid;
}, 30_000);

test('a partner node loaded in ComfyUI stops everything', async () => {
  const { ctx, l, lines } = await fakeContext({ partner: true });
  expect(await startAll(ctx, { browser: false })).toBe(1);
  expect(lines.join('\n')).toContain('PartnerThing');
  expect(lines.join('\n')).toContain('--disable-partner-nodes');
  expect(existsSync(join(l.runDir, 'comfyui.pid'))).toBe(false);
}, 30_000);

test('an unreadable /object_info stops what had started and says so', async () => {
  const { ctx, l, lines } = await fakeContext({ brokenInfo: true });
  try {
    expect(await startAll(ctx, { browser: false })).toBe(1);
    expect(lines.join('\n')).toContain('/object_info');
    expect(existsSync(join(l.runDir, 'comfyui.pid'))).toBe(false);
  } finally {
    await stopAll(ctx);
  }
}, 30_000);

test('start refuses an install that never finished', async () => {
  const { ctx, lines } = await fakeContext();
  expect(await startAll({ ...ctx, state: emptyState() }, { browser: false })).toBe(1);
  expect(lines.join('\n')).toContain('install');
});

test('start refuses a MONTAGIO_COMFYUI_ARGS that would listen beyond 127.0.0.1, and starts nothing', async () => {
  const { ctx, l, lines } = await fakeContext();
  vi.stubEnv('MONTAGIO_COMFYUI_ARGS', '--listen 0.0.0.0');
  try {
    expect(await startAll(ctx, { browser: false })).toBe(1);
  } finally {
    vi.unstubAllEnvs();
    await stopAll(ctx);
  }
  expect(lines.join('\n')).toContain('MONTAGIO_COMFYUI_ARGS');
  expect(existsSync(join(l.runDir, 'comfyui.pid'))).toBe(false);
  // The app alone runs no ComfyUI: the variable does not concern it.
  vi.stubEnv('MONTAGIO_COMFYUI_ARGS', '--listen 0.0.0.0');
  try {
    const appOnly = { ...ctx, state: { ...ctx.state, mode: 'app-only' as const }, specs: ctx.specs!.filter((s) => s.name === 'app') };
    expect(await startAll(appOnly, { browser: false })).toBe(0);
    await stopAll(appOnly);
  } finally {
    vi.unstubAllEnvs();
  }
}, 30_000);

test('the default ports are the ones the spec names', () => {
  expect(DEFAULT_PORTS).toEqual({ comfy: 8188, proxy: 8189, app: 3000 });
});
