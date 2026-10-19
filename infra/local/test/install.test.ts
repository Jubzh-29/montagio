import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture as realCapture, type Capture, type Captured, type Stream } from '../src/exec.ts';
import { install, markOwned, renderReport, type InstallDeps, type InstallOptions } from '../src/install.ts';
import { parseVersionsEnv } from '../src/pins.ts';
import { layout, osOf } from '../src/platform.ts';
import type { MachineFacts } from '../src/probe.ts';
import { readState } from '../src/state.ts';

const realRoot = fileURLToPath(new URL('../../../', import.meta.url));
const os = osOf(process.platform)!;
const COMMIT = parseVersionsEnv(readFileSync(join(realRoot, 'infra', 'runpod', 'versions.env'), 'utf8')).COMFYUI_COMMIT!;
const GiB = 1024 ** 3;

const WEIGHTS = [
  { id: 'tiny-vae', file: 'tiny_vae.safetensors', folder: 'vae', content: 'vae bytes' },
  { id: 'tiny-te', file: 'tiny_te.safetensors', folder: 'text_encoders', content: 'text encoder bytes' },
].map((w) => ({ ...w, size: Buffer.byteLength(w.content), sha256: createHash('sha256').update(w.content).digest('hex') }));

let base: string;
let repo: string;
let dir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'montagio install '));
  repo = join(base, 'repo dir');
  dir = join(base, 'Install Dir');
  // A small repository: the real pins, a two-file lock, the files the plan looks at.
  mkdirSync(join(repo, 'infra', 'runpod'), { recursive: true });
  cpSync(join(realRoot, 'infra', 'runpod', 'versions.env'), join(repo, 'infra', 'runpod', 'versions.env'));
  mkdirSync(join(repo, 'registry'));
  writeLock(WEIGHTS);
  writeFileSync(join(repo, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  mkdirSync(join(repo, 'node_modules'));
  writeFileSync(join(repo, 'node_modules', '.package-lock.json'), '{}');
  mkdirSync(join(repo, 'comfy-nodes'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function writeLock(weights: typeof WEIGHTS): void {
  writeFileSync(
    join(repo, 'registry', 'models.lock.yaml'),
    `schema: montagio/lock@0.1\nweights:\n${weights
      .map(
        (w) =>
          `  - id: ${w.id}\n    file: ${w.file}\n    url: https://huggingface.co/Comfy-Org/x/resolve/main/split_files/${w.folder}/${w.file}\n    sha256: ${w.sha256}\n    size: ${w.size}\n    license: Apache-2.0\n    source: https://huggingface.co/x/y\n`,
      )
      .join('')}`,
  );
}

function facts(over: Partial<MachineFacts> = {}): MachineFacts {
  return {
    os,
    platform: process.platform,
    arch: 'x64',
    node: [22, 23, 2],
    git: true,
    ffmpeg: true,
    ffprobe: true,
    gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 4090', vramMiB: 24564, driver: '580.65' }],
    driverCuda: [13, 0],
    pythons: [{ command: ['py', '-3.12'], version: [3, 12, 10], hasVenv: true }],
    freeBytes: { installDir: 500 * GiB, repo: 500 * GiB },
    sameVolume: false,
    ramBytes: 64 * GiB,
    busyPorts: [],
    ...over,
  };
}

type Call = { cmd: string; args: string[]; cwd?: string; shell?: boolean; env?: NodeJS.ProcessEnv };

function harness(
  opts: { facts?: MachineFacts; failOn?: (call: Call) => boolean; ask?: InstallDeps['ask']; comfyHead?: string; gitStatus?: Captured } = {},
) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const events: string[] = [];
  /** The programs run and the services stopped or started, in one order. */
  const timeline: string[] = [];
  /** For each weight fetch-weights is asked for: did its file exist when it was asked? */
  const existedBefore: Record<string, boolean> = {};
  const L = layout(dir, os);
  const stream: Stream = async (cmd, args, o = {}) => {
    const call = { cmd, args, cwd: o.cwd, shell: o.shell, env: o.env };
    calls.push(call);
    timeline.push([cmd, ...args].join(' '));
    if (opts.failOn?.(call)) return 1;
    // What the real programs leave behind, which the plan checks for.
    if (args.includes('venv')) {
      const venv = args.at(-1)!;
      const python = os === 'windows' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
      mkdirSync(dirname(python), { recursive: true });
      writeFileSync(python, '');
    }
    if (args.some((a) => a.startsWith('comfy-api-proxy=='))) writeFileSync(L.proxyExe, '');
    if (args[1] === 'build') {
      mkdirSync(join(repo, 'apps', 'web', '.next'), { recursive: true });
      writeFileSync(join(repo, 'apps', 'web', '.next', 'BUILD_ID'), 'x');
    }
    if (cmd === 'git' && args[0] === 'clone') {
      const target = args.at(-1)!;
      mkdirSync(join(target, '.git'), { recursive: true });
      mkdirSync(join(target, 'custom_nodes'));
      writeFileSync(join(target, 'requirements.txt'), 'torch\n');
    }
    const fetch = args.indexOf('--models-dir');
    if (fetch > 0) {
      const models = args[fetch + 1]!;
      const only = args[args.indexOf('--only') + 1]!.split(',');
      const out = args[args.indexOf('--out') + 1]!;
      for (const w of WEIGHTS.filter((w) => only.includes(w.id))) {
        existedBefore[w.id] = existsSync(join(models, w.folder, w.file));
        mkdirSync(join(models, w.folder), { recursive: true });
        writeFileSync(join(models, w.folder, w.file), w.content);
      }
      mkdirSync(out, { recursive: true });
      const report = { weights: WEIGHTS.filter((w) => only.includes(w.id)).map((w) => ({ id: w.id, status: 'downloaded', sha256: w.sha256 })) };
      writeFileSync(join(out, 'weights-report.json'), JSON.stringify(report));
    }
    return 0;
  };
  const capture: Capture = async (cmd, args) => {
    if (cmd === 'git' && args[0] === '-C' && args[2] === 'rev-parse') {
      const where = args[1]!;
      if (where === repo) return { code: 0, stdout: 'abc123\n', stderr: '' };
      if (!existsSync(join(where, '.git'))) return { code: 128, stdout: '', stderr: 'not a git repository' };
      return { code: 0, stdout: `${where === L.comfyDir && opts.comfyHead ? opts.comfyHead : COMMIT}\n`, stderr: '' };
    }
    if (cmd === 'git' && args[2] === 'status') return opts.gitStatus ?? { code: 0, stdout: '', stderr: '' };
    return { code: null, stdout: '', stderr: '' };
  };
  const deps: InstallDeps = {
    os,
    capture,
    stream,
    log: (line) => lines.push(line),
    ask: opts.ask ?? null,
    stopAll: async () => void (events.push('stopAll'), timeline.push('stopAll')),
    startAll: async () => {
      events.push('startAll');
      timeline.push('startAll');
      return 0;
    },
    runningPorts: async () => [],
    probe: async () => opts.facts ?? facts(),
  };
  return { calls, lines, events, timeline, existedBefore, deps, L, output: () => lines.join('\n') };
}

const options = (over: Partial<InstallOptions> = {}): InstallOptions => ({
  dir,
  mode: 'full',
  ignoreVram: false,
  ports: {},
  proxyUrl: null,
  demo: false,
  dryRun: false,
  start: true,
  browser: false,
  ...over,
});

const described = (calls: Call[]) => calls.map((c) => [c.cmd, ...c.args].join(' '));

test('dry run executes nothing and writes nothing', async () => {
  const h = harness();
  expect(await install(repo, options({ dryRun: true }), h.deps)).toBe(0);
  expect(h.calls).toEqual([]);
  expect(h.events).toEqual([]);
  expect(existsSync(dir)).toBe(false);
  const out = h.output();
  for (const id of ['npm-ci', 'comfyui', 'comfyui-env', 'proxy', 'node-pack', 'weights', 'open-stack', 'app-build', 'save-state', 'start']) {
    expect(out).toMatch(new RegExp(`\\[(run|skip)\\]\\s+${id}\\b`));
  }
  expect(out).toContain(`git clone --depth 1 --branch v0.41.0 https://github.com/Comfy-Org/ComfyUI.git ${h.L.comfyTmp}`);
  expect(out).toContain('nothing was changed');
});

test('the dry run refuses a real custom_nodes/montagio folder, as the real run does', async () => {
  await install(repo, options({ start: false }), harness().deps);
  const h = harness();
  unlinkSync(h.L.packLink);
  mkdirSync(h.L.packLink);
  expect(await install(repo, options({ dryRun: true }), h.deps)).toBe(2);
  expect(h.output()).toContain(`${h.L.packLink} is a folder, not a link`);
  expect(h.output()).not.toContain('[run]');
});

test('a 4 GB GPU: the dry run points to --app-only and exits 2', async () => {
  const h = harness({ facts: facts({ gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 3050 Laptop GPU', vramMiB: 4096, driver: '616.92' }] }) });
  expect(await install(repo, options({ dryRun: true }), h.deps)).toBe(2);
  expect(h.output()).toContain('--app-only');
  expect(h.calls).toEqual([]);
});

test('a 4 GB GPU: a yes installs the app alone, no terminal stops', async () => {
  const weak = facts({ gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 3050 Laptop GPU', vramMiB: 4096, driver: '616.92' }] });
  const refused = harness({ facts: weak });
  expect(await install(repo, options(), refused.deps)).toBe(2);
  expect(refused.calls).toEqual([]);

  const questions: string[] = [];
  const accepted = harness({ facts: weak, ask: async (q) => (questions.push(q), true) });
  expect(await install(repo, options(), accepted.deps)).toBe(0);
  expect(questions[0]).toContain('app alone');
  expect(described(accepted.calls).some((c) => c.includes('git clone') || c.includes('pip'))).toBe(false);
  expect(readState(accepted.L.statePath)).toMatchObject({ mode: 'app-only', gpuIndex: null });
  expect(accepted.events).toEqual(['startAll']);
});

test('a full install runs every step and records it', async () => {
  const h = harness();
  expect(await install(repo, options(), h.deps)).toBe(0);
  const state = readState(h.L.statePath);
  expect(state.mode).toBe('full');
  expect(state.gpuIndex).toBe(0);
  expect(Object.keys(state.stamps).sort()).toEqual(['build', 'comfyEnv', 'comfyui', 'npm', 'proxy']);
  expect(Object.keys(state.weights).sort()).toEqual(['tiny-te', 'tiny-vae']);
  expect(existsSync(h.L.comfyTmp)).toBe(false);
  expect(existsSync(join(h.L.comfyDir, '.git'))).toBe(true);
  expect(readlinkSync(h.L.packLink).replace(/^\\\\\?\\/, '').replace(/[\\/]$/, '').toLowerCase()).toBe(join(repo, 'comfy-nodes').toLowerCase());
  expect(h.events).toEqual(['startAll']);
});

test('a second run is a no-op', async () => {
  await install(repo, options(), harness().deps);
  const again = harness();
  expect(await install(repo, options(), again.deps)).toBe(0);
  expect(described(again.calls)).toHaveLength(1);
  expect(described(again.calls)[0]).toContain('check-open-stack');
  expect(again.events).toEqual(['startAll']);
});

test('a rerun after an interruption resumes without manual cleanup', async () => {
  const cut = harness({ failOn: (c) => c.args.includes('-r') });
  expect(await install(repo, options(), cut.deps)).toBe(1);
  const state = readState(cut.L.statePath);
  expect(state.stamps.comfyui).toBe(COMMIT);
  expect(state.stamps.comfyEnv).toBeUndefined();
  expect(cut.events).toEqual([]);

  const resumed = harness();
  expect(await install(repo, options(), resumed.deps)).toBe(0);
  const calls = described(resumed.calls);
  expect(calls.some((c) => c.includes('git clone'))).toBe(false);
  expect(calls.some((c) => c.includes(' -r '))).toBe(true);
});

test('a lost install-state.json does not make Montagio refuse its own ComfyUI', async () => {
  // Also what a Ctrl+C between the rename of ComfyUI.tmp and its stamp leaves.
  await install(repo, options({ start: false }), harness().deps);
  const h = harness();
  rmSync(h.L.statePath);
  expect(await install(repo, options({ start: false }), h.deps)).toBe(0);
  expect(h.output()).not.toContain('was not installed by Montagio');
  expect(described(h.calls).some((c) => c.includes('git clone'))).toBe(false);
});

test('the ownership marker leaves git status clean, so the next update is not refused', async () => {
  const clone = join(base, 'real clone');
  mkdirSync(clone);
  expect((await realCapture('git', ['-C', clone, 'init', '-q'])).code).toBe(0);
  markOwned(clone);
  expect(existsSync(join(clone, '.montagio'))).toBe(true);
  expect(await realCapture('git', ['-C', clone, 'status', '--porcelain'])).toMatchObject({ code: 0, stdout: '' });
});

test('a clone cut short is removed and cloned again', async () => {
  const h = harness();
  mkdirSync(h.L.comfyTmp, { recursive: true });
  writeFileSync(join(h.L.comfyTmp, 'half-cloned.txt'), 'x');
  expect(await install(repo, options({ start: false }), h.deps)).toBe(0);
  expect(existsSync(h.L.comfyTmp)).toBe(false);
  expect(existsSync(join(h.L.comfyDir, 'half-cloned.txt'))).toBe(false);
});

test('a git status that fails before an update is reported with its error, not as local changes', async () => {
  await install(repo, options({ start: false }), harness().deps);
  const dubious = { code: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at 'C:/S/ComfyUI'\n" };
  const h = harness({ comfyHead: 'f'.repeat(40), gitStatus: dubious });
  expect(await install(repo, options({ start: false }), h.deps)).toBe(1);
  expect(h.output()).toContain('detected dubious ownership');
  expect(h.output()).not.toContain('has local changes');
  const changed = harness({ comfyHead: 'f'.repeat(40), gitStatus: { code: 0, stdout: ' M comfy/sd.py\n', stderr: '' } });
  expect(await install(repo, options({ start: false }), changed.deps)).toBe(1);
  expect(changed.output()).toContain('has local changes');
});

test('paths with spaces reach every command as single arguments', async () => {
  const h = harness();
  await install(repo, options(), h.deps);
  expect(h.calls.every((c) => !c.shell)).toBe(true);
  const clone = h.calls.find((c) => c.args[0] === 'clone')!;
  expect(clone.args.at(-1)).toBe(h.L.comfyTmp);
  const requirements = h.calls.find((c) => c.args.includes('-r'))!;
  expect(requirements.cmd).toBe(h.L.comfyPython);
  expect(requirements.args[requirements.args.indexOf('-r') + 1]).toBe(join(h.L.comfyDir, 'requirements.txt'));
  const weights = h.calls.find((c) => c.args.includes('--models-dir'))!;
  expect(weights.args[weights.args.indexOf('--models-dir') + 1]).toBe(h.L.modelsDir);
  expect(weights.cwd).toBe(repo);
  const venv = h.calls.find((c) => c.args.includes('venv'))!;
  expect(venv.args.at(-1)).toBe(h.L.comfyVenv);
});

test('the torch command and its constraints pin the exact build', async () => {
  const h = harness();
  await install(repo, options(), h.deps);
  const torch = described(h.calls).find((c) => c.includes('--index-url'))!;
  expect(torch).toContain('--index-url https://download.pytorch.org/whl/cu130 torch==2.14.1 torchvision==0.29.1');
  expect(readFileSync(join(h.L.cacheDir, 'torch-constraints.txt'), 'utf8')).toBe('torch==2.14.1\ntorchvision==0.29.1\n');
});

test('the CUDA check looks at the GPU the checks chose, numbered as nvidia-smi numbers it', async () => {
  const two = facts({
    gpus: [
      { index: 0, name: 'NVIDIA GeForce RTX 3060', vramMiB: 12288, driver: '580.65' },
      { index: 1, name: 'NVIDIA GeForce RTX 4090', vramMiB: 24564, driver: '580.65' },
    ],
  });
  const h = harness({ facts: two });
  await install(repo, options({ start: false }), h.deps);
  const check = h.calls.find((c) => c.args[0] === '-I')!;
  expect(check.env).toMatchObject({ CUDA_DEVICE_ORDER: 'PCI_BUS_ID', CUDA_VISIBLE_DEVICES: '1' });
  expect(readState(h.L.statePath).gpuIndex).toBe(1);
});

test('a weight half downloaded counts only its missing bytes in the disk check', async () => {
  // An install cut during the download: everything else is in place, a .part is left.
  const cut = harness({ failOn: (c) => c.args.includes('--models-dir') });
  expect(await install(repo, options({ start: false }), cut.deps)).toBe(1);
  const te = WEIGHTS[1]!;
  mkdirSync(join(cut.L.modelsDir, te.folder), { recursive: true });
  writeFileSync(join(cut.L.modelsDir, te.folder, `${te.file}.part`), te.content.slice(0, 10));
  const total = WEIGHTS.reduce((sum, w) => sum + w.size, 0);
  // Room for the margin and what is left of the weights, not for the 10 bytes already there.
  const free = 2 * GiB + total - 10;
  const h = harness({ facts: facts({ freeBytes: { installDir: free, repo: 500 * GiB } }) });
  expect(await install(repo, options({ dryRun: true }), h.deps)).toBe(0);
  expect(h.output()).not.toMatch(/FAIL\s+disk/);
});

test('a weight the lock now pins with another sha256 is removed, then fetched again', async () => {
  await install(repo, options({ start: false }), harness().deps);
  writeLock([{ ...WEIGHTS[0]!, sha256: 'e'.repeat(64) }, WEIGHTS[1]!]);
  const again = harness();
  await install(repo, options({ start: false }), again.deps);
  const fetch = again.calls.find((c) => c.args.includes('--only'))!;
  expect(fetch.args[fetch.args.indexOf('--only') + 1]).toBe('tiny-vae');
  expect(again.existedBefore['tiny-vae']).toBe(false);
});

test('a program removed after the install is installed again', async () => {
  const h = harness();
  await install(repo, options({ start: false }), h.deps);
  rmSync(h.L.proxyExe);
  const again = harness();
  await install(repo, options({ start: false }), again.deps);
  expect(described(again.calls).some((c) => c.includes('comfy-api-proxy==0.1.6'))).toBe(true);
  expect(described(again.calls).some((c) => c.includes('git clone'))).toBe(false);
});

test('a port option is kept for the next runs', async () => {
  const h = harness();
  await install(repo, options({ ports: { comfy: 8288 } }), h.deps);
  expect(readState(h.L.statePath).ports).toEqual({ comfy: 8288, proxy: 8189, app: 3000 });
  await install(repo, options(), harness().deps);
  expect(readState(h.L.statePath).ports.comfy).toBe(8288);
});

test('a saved --proxy-url is kept by the next runs, and --demo forgets it', async () => {
  const h = harness();
  const appOnly = (over: Partial<InstallOptions>) => install(repo, options({ mode: 'app-only', start: false, ...over }), harness().deps);
  await appOnly({ proxyUrl: 'http://127.0.0.1:9189' });
  expect(readState(h.L.statePath).proxyUrl).toBe('http://127.0.0.1:9189');
  await appOnly({});
  expect(readState(h.L.statePath).proxyUrl).toBe('http://127.0.0.1:9189');
  expect(await appOnly({ demo: true })).toBe(0);
  expect(readState(h.L.statePath).proxyUrl).toBeNull();
});

test('no Comfy key reaches the programs install runs, whatever the case of its name on Windows', async () => {
  const h = harness();
  h.deps.env = { PATH: process.env.PATH, COMFY_API_KEY: 'secret', Comfy_Api_Key: 'secret' };
  await install(repo, options({ start: false }), h.deps);
  const names = new Set(h.calls.flatMap((c) => Object.keys(c.env ?? {})).filter((name) => name.toUpperCase() === 'COMFY_API_KEY'));
  // On Linux, Comfy_Api_Key is another variable than COMFY_API_KEY.
  expect([...names]).toEqual(os === 'windows' ? [] : ['Comfy_Api_Key']);
});

test('running services are stopped before anything else', async () => {
  const h = harness();
  h.deps.runningPorts = async () => [8188, 8189, 3000];
  await install(repo, options(), h.deps);
  // One timeline: the stop comes before npm ci, the clone and every other program.
  expect(h.timeline.length).toBeGreaterThan(2);
  expect(h.timeline[0]).toBe('stopAll');
  expect(h.timeline.at(-1)).toBe('startAll');
  expect(h.timeline.filter((entry) => entry === 'stopAll')).toHaveLength(1);
});

test('the report is plain ASCII', () => {
  const report = renderReport(
    [
      { id: 'gpu', severity: 'fail', message: 'NVIDIA GeForce RTX 3050, 4.0 GiB of VRAM', fix: 'run again with --app-only' },
      { id: 'ram', severity: 'warn', message: '16.0 GiB of RAM' },
      { id: 'node', severity: 'ok', message: 'Node.js 22.23.2' },
    ],
    { kind: 'offer-app-only', reason: 'no GPU' },
    [{ id: 'npm-ci', title: 'install', run: true, why: 'node_modules is missing', detail: ['npm ci'] }],
    { dir: 'C:\\Montagio', dryRun: true, mode: 'full' },
  );
  expect(report).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
  expect(report).toContain('FAIL');
  expect(report).toContain('-> run again with --app-only');
});
