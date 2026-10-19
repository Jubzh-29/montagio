import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLock, readVersions } from '../src/pins.ts';
import { buildPlan, buildStamp, diskNeed, envStamp, proxyStamp, weightsToClear, weightsToFetch, type PlanInput, type Step } from '../src/plan.ts';
import { layout } from '../src/platform.ts';
import { emptyState, type InstallState } from '../src/state.ts';

const realRoot = fileURLToPath(new URL('../../../', import.meta.url));
const versions = readVersions(realRoot);
const lock = readLock(realRoot);
const repoRoot = 'C:\\Users\\a b\\repo dir';
const L = layout('C:\\Users\\a b\\Install Dir', 'windows');
const python = { command: ['py', '-3.12'], version: [3, 12, 10] as [number, number, number], hasVenv: true };
const GiB = 1024 ** 3;

function fresh(over: Partial<PlanInput> = {}): PlanInput {
  return {
    os: 'windows',
    mode: 'full',
    layout: L,
    repoRoot,
    versions,
    torch: versions.torch,
    python,
    state: emptyState(),
    lock,
    weightStat: () => null,
    comfy: { head: null, exists: false, tmpExists: false },
    packTarget: null,
    artifacts: { comfyPython: false, proxyExe: false, appBuild: false },
    repo: { head: 'abc123', lockHash: 'h1', nodeModules: false },
    servicesRunning: false,
    start: true,
    ...over,
  };
}

function installedState(): InstallState {
  return {
    ...emptyState(),
    mode: 'full',
    stamps: {
      comfyui: versions.comfyuiCommit,
      comfyEnv: envStamp(versions.comfyuiCommit, versions.torch, python.version),
      proxy: proxyStamp(versions, python.version)!,
      npm: 'h1',
      build: buildStamp('abc123', 'h1')!,
    },
    weights: Object.fromEntries(lock.map((w) => [w.id, { sha256: w.sha256, size: w.size, mtimeMs: 1 }])),
  };
}

function installed(over: Partial<PlanInput> = {}): PlanInput {
  return fresh({
    state: installedState(),
    weightStat: (w) => ({ size: w.size, mtimeMs: 1 }),
    comfy: { head: versions.comfyuiCommit, exists: true, tmpExists: false },
    packTarget: win32.join(repoRoot, 'comfy-nodes'),
    artifacts: { comfyPython: true, proxyExe: true, appBuild: true },
    repo: { head: 'abc123', lockHash: 'h1', nodeModules: true },
    ...over,
  });
}

const running = (steps: Step[]) => steps.filter((step) => step.run).map((step) => step.id);
const step = (steps: Step[], id: Step['id']) => steps.find((s) => s.id === id)!;

test('a fresh machine runs every install step, in order', () => {
  const steps = buildPlan(fresh());
  expect(steps.map((s) => s.id)).toEqual([
    'stop-services', 'npm-ci', 'comfyui', 'comfyui-env', 'proxy', 'node-pack', 'weights', 'open-stack', 'app-build', 'save-state', 'start',
  ]);
  expect(running(steps)).toEqual(['npm-ci', 'comfyui', 'comfyui-env', 'proxy', 'node-pack', 'weights', 'open-stack', 'app-build', 'save-state', 'start']);
});

test('a first install says so, not that something changed', () => {
  const steps = buildPlan(fresh({ repo: { head: 'abc123', lockHash: 'h1', nodeModules: true } }));
  expect(step(steps, 'npm-ci').why).toBe('first install');
  expect(step(steps, 'app-build').why).toBe('not built yet');
});

test('a fully installed machine skips every install step', () => {
  expect(running(buildPlan(installed()))).toEqual(['open-stack', 'save-state', 'start']);
  expect(running(buildPlan(installed({ start: false })))).toEqual(['open-stack', 'save-state']);
});

test('running services are stopped first and started last', () => {
  const steps = buildPlan(installed({ servicesRunning: true }));
  expect(steps[0]).toMatchObject({ id: 'stop-services', run: true });
  expect(steps.at(-1)).toMatchObject({ id: 'start', run: true });
});

test('a new torch pin rebuilds the ComfyUI environment', () => {
  const newer = { ...versions, torch: { ...versions.torch, torch: '2.15.0' } };
  expect(running(buildPlan(installed({ versions: newer, torch: newer.torch })))).toContain('comfyui-env');
});

test('a new sha256 in the lock, or another mtime, fetches that weight alone', () => {
  const changed = lock.map((w) => (w.id === 'wan21-vae' ? { ...w, sha256: '0'.repeat(64) } : w));
  expect(weightsToFetch(changed, installedState(), (w) => ({ size: w.size, mtimeMs: 1 })).map((w) => w.id)).toEqual(['wan21-vae']);
  expect(weightsToFetch(lock, installedState(), (w) => ({ size: w.size, mtimeMs: w.id === 'flux-ae' ? 2 : 1 })).map((w) => w.id)).toEqual(['flux-ae']);
  expect(weightsToFetch(lock, installedState(), (w) => (w.id === 'qwen3-4b' ? null : { size: w.size, mtimeMs: 1 })).map((w) => w.id)).toEqual(['qwen3-4b']);
});

test('a ComfyUI of ours at another commit is updated in place', () => {
  const comfy = step(buildPlan(installed({ comfy: { head: 'f'.repeat(40), exists: true, tmpExists: false } })), 'comfyui');
  expect(comfy.run).toBe(true);
  expect(comfy.detail.join('\n')).toMatch(/fetch --depth 1 origin tag v0\.41\.0[\s\S]*checkout --detach 98cc0bf8/);
});

test('a ComfyUI folder Montagio did not install is refused', () => {
  expect(() => buildPlan(fresh({ comfy: { head: 'f'.repeat(40), exists: true, tmpExists: false } }))).toThrow(
    /ComfyUI exists and was not installed by Montagio: choose another --dir/,
  );
});

test('a real custom_nodes/montagio folder is refused by the plan, as the run refuses it', () => {
  // readLink gives the link's own path when it is a folder, not a link.
  expect(() => buildPlan(installed({ packTarget: L.packLink }))).toThrow(/is a folder, not a link to .*comfy-nodes: move it away/);
  expect(() => buildPlan(installed({ packTarget: L.packLink.toUpperCase() }))).toThrow(/is a folder/);
});

test('a clone left half done is removed first, then cloned again', () => {
  const comfy = step(buildPlan(fresh({ comfy: { head: null, exists: false, tmpExists: true } })), 'comfyui');
  expect(comfy.detail[0]).toContain(`remove ${L.comfyTmp}`);
  expect(comfy.detail.join('\n')).toContain(`git clone --depth 1 --branch v0.41.0 ${versions.comfyuiRepo} ${L.comfyTmp}`);
});

test('the app alone has no ComfyUI, proxy, pack or weights step', () => {
  const ids = buildPlan(fresh({ mode: 'app-only', python: null, torch: null })).map((s) => s.id);
  for (const id of ['comfyui', 'comfyui-env', 'proxy', 'node-pack', 'weights'] as const) expect(ids).not.toContain(id);
});

test('the app alone says whether it renders through a saved proxy URL or runs the demo', () => {
  const appOnly = (proxyUrl: string | null) =>
    step(buildPlan(fresh({ mode: 'app-only', python: null, torch: null, state: { ...emptyState(), proxyUrl } })), 'start').detail.join('\n');
  expect(appOnly('http://127.0.0.1:9189')).toContain('comfy-api-proxy at http://127.0.0.1:9189 (--demo forgets it)');
  expect(appOnly(null)).toContain('demo mode');
});

test('the weights step lists each file with its size and folder', () => {
  const weights = step(buildPlan(fresh()), 'weights');
  expect(weights.detail).toContainEqual(expect.stringMatching(/diffusion_models\/wan2\.2_fun_camera_high_noise_14B_fp8_scaled\.safetensors\s+14\.25 GiB/));
  expect(weights.detail.join('\n')).toContain('infra/runpod/fetch-weights.ts');
});

test('the torch step names the CUDA index and the exact versions', () => {
  const env = step(buildPlan(fresh()), 'comfyui-env').detail.join('\n');
  expect(env).toContain('--index-url https://download.pytorch.org/whl/cu130 torch==2.14.1 torchvision==0.29.1');
  expect(env).toContain(L.comfyPython);
});

test('a changed package-lock reinstalls npm and rebuilds the app', () => {
  expect(running(buildPlan(installed({ repo: { head: 'abc123', lockHash: 'h2', nodeModules: true } })))).toEqual(
    expect.arrayContaining(['npm-ci', 'app-build']),
  );
  expect(running(buildPlan(installed({ repo: { head: null, lockHash: 'h1', nodeModules: true } })))).toContain('app-build');
});

test('diskNeed counts the weights to fetch, the environment and the margins', () => {
  const total = lock.reduce((sum, w) => sum + w.size, 0);
  expect(total).toBe(69_691_750_955);
  const need = diskNeed(buildPlan(fresh()), lock, () => 0);
  expect(need.installDir).toBe(total + 12 * GiB + 0.5 * GiB + 2 * GiB);
  expect(need.repo).toBe(2 * GiB + 1 * GiB + 2 * GiB);
  expect(diskNeed(buildPlan(installed()), [], () => 0)).toEqual({ installDir: 2 * GiB, repo: 2 * GiB });
});

test('diskNeed counts only the bytes still missing of a weight already partly or fully on disk', () => {
  const total = lock.reduce((sum, w) => sum + w.size, 0);
  const high = lock.find((w) => w.id === 'wan22-fun-camera-high')!;
  const half = diskNeed(buildPlan(fresh()), lock, (w) => (w === high ? 10 * GiB : 0));
  expect(half.installDir).toBe(total - 10 * GiB + 12 * GiB + 0.5 * GiB + 2 * GiB);
  const whole = diskNeed(buildPlan(fresh()), lock, (w) => (w === high ? high.size : 0));
  expect(whole.installDir).toBe(total - high.size + 12 * GiB + 0.5 * GiB + 2 * GiB);
});

test('a weight file the lock no longer pins is cleared before the download', () => {
  const vae = lock.find((w) => w.id === 'wan21-vae')!;
  const changed = lock.map((w) => (w === vae ? { ...w, sha256: '0'.repeat(64) } : w));
  const stat = (w: { size: number }) => ({ size: w.size, mtimeMs: 1 });
  // Recorded by Montagio with the old sha256, untouched since: the old pinned file.
  expect(weightsToClear(changed, installedState(), stat).map((w) => w.id)).toEqual(['wan21-vae']);
  // A file whose size is not the lock one cannot be the pinned file.
  expect(weightsToClear(lock, emptyState(), (w) => (w === vae ? { size: 5, mtimeMs: 1 } : null)).map((w) => w.id)).toEqual(['wan21-vae']);
  // An unrecorded file of the right size may be right: fetch-weights hashes it.
  expect(weightsToClear(lock, emptyState(), stat)).toEqual([]);
  expect(weightsToClear(lock, installedState(), stat)).toEqual([]);
  const weights = step(buildPlan(installed({ lock: changed })), 'weights');
  expect(weights.detail[0]).toContain('remove ');
  expect(weights.detail[0]).toContain('wan_2.1_vae.safetensors');
});

test('a stamp whose artifact is gone runs its step again', () => {
  const gone = (missing: Partial<PlanInput['artifacts']>) =>
    running(buildPlan(installed({ artifacts: { comfyPython: true, proxyExe: true, appBuild: true, ...missing } })));
  expect(gone({ comfyPython: false })).toContain('comfyui-env');
  expect(gone({ proxyExe: false })).toContain('proxy');
  expect(gone({ appBuild: false })).toContain('app-build');
  expect(step(buildPlan(installed({ artifacts: { comfyPython: true, proxyExe: false, appBuild: true } })), 'proxy').why).toContain('missing');
});

test('another Python rebuilds the proxy environment too', () => {
  const py313 = { command: ['py', '-3.13'], version: [3, 13, 1] as [number, number, number], hasVenv: true };
  expect(running(buildPlan(installed({ python: py313 })))).toEqual(expect.arrayContaining(['comfyui-env', 'proxy']));
  expect(proxyStamp(versions, [3, 12, 10])).toBe('comfy-api-proxy==0.1.6 python==3.12');
  expect(proxyStamp(versions, null)).toBeNull();
});

test('envStamp and buildStamp change with what they depend on', () => {
  expect(envStamp('c', versions.torch, [3, 12, 10])).toBe('c torch==2.14.1+cu130 torchvision==0.29.1 python==3.12');
  expect(buildStamp(null, 'h')).toBeNull();
  expect(buildStamp('a', 'h')).not.toBe(buildStamp('a', 'h2'));
});
