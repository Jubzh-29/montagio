import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLock, readVersions } from '../src/pins.ts';
import { buildPlan, buildStamp, diskNeed, envStamp, weightsToFetch, type PlanInput, type Step } from '../src/plan.ts';
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
      proxy: `comfy-api-proxy==${versions.proxyVersion}`,
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

test('a clone left half done is removed first, then cloned again', () => {
  const comfy = step(buildPlan(fresh({ comfy: { head: null, exists: false, tmpExists: true } })), 'comfyui');
  expect(comfy.detail[0]).toContain(`remove ${L.comfyTmp}`);
  expect(comfy.detail.join('\n')).toContain(`git clone --depth 1 --branch v0.41.0 ${versions.comfyuiRepo} ${L.comfyTmp}`);
});

test('the app alone has no ComfyUI, proxy, pack or weights step', () => {
  const ids = buildPlan(fresh({ mode: 'app-only', python: null, torch: null })).map((s) => s.id);
  for (const id of ['comfyui', 'comfyui-env', 'proxy', 'node-pack', 'weights'] as const) expect(ids).not.toContain(id);
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
  const need = diskNeed(buildPlan(fresh()), lock);
  expect(need.installDir).toBe(total + 12 * GiB + 0.5 * GiB + 2 * GiB);
  expect(need.repo).toBe(2 * GiB + 1 * GiB + 2 * GiB);
  expect(diskNeed(buildPlan(installed()), [])).toEqual({ installDir: 2 * GiB, repo: 2 * GiB });
});

test('envStamp and buildStamp change with what they depend on', () => {
  expect(envStamp('c', versions.torch, [3, 12, 10])).toBe('c torch==2.14.1+cu130 torchvision==0.29.1 python==3.12');
  expect(buildStamp(null, 'h')).toBeNull();
  expect(buildStamp('a', 'h')).not.toBe(buildStamp('a', 'h2'));
});
