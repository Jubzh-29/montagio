/**
 * The install plan: every step, whether it runs and why, and what it would do.
 * Pure: a step runs when its stamp in the state no longer matches what it
 * would install, so running the installer again, after an update or after
 * an interruption, does only what is missing.
 */
import type { Mode } from './checks.ts';
import type { LockWeight, TorchPin, Versions } from './pins.ts';
import { pathFor, type Layout, type Os } from './platform.ts';
import type { PythonInfo } from './probe.ts';
import type { InstallState } from './state.ts';

export type StepId =
  | 'stop-services'
  | 'npm-ci'
  | 'comfyui'
  | 'comfyui-env'
  | 'proxy'
  | 'node-pack'
  | 'weights'
  | 'yt-dlp'
  | 'open-stack'
  | 'app-build'
  | 'save-state'
  | 'start';

export type Step = { id: StepId; title: string; run: boolean; why: string; detail: string[] };

export type FileStat = { size: number; mtimeMs: number };

export type PlanInput = {
  os: Os;
  mode: Mode;
  layout: Layout;
  repoRoot: string;
  versions: Versions;
  torch: TorchPin | null;
  python: PythonInfo | null;
  state: InstallState;
  lock: LockWeight[];
  weightStat: (weight: LockWeight) => FileStat | null;
  /**
   * head: the commit of layout.comfyDir (null if absent or unreadable); tmpExists: an interrupted clone is left;
   * marked: it holds the marker a Montagio clone leaves, which still says it is ours when the state is lost.
   */
  comfy: { head: string | null; exists: boolean; tmpExists: boolean; marked: boolean };
  /** Where custom_nodes/montagio points today: null if it does not exist, its own path if it is a real folder. */
  packTarget: string | null;
  /** What the stamps stand for is still there: the venv Python, the proxy launcher, the app build (BUILD_ID), yt-dlp. */
  artifacts: { comfyPython: boolean; proxyExe: boolean; appBuild: boolean; ytDlp: boolean };
  /** head: the repository's commit (null outside git); lockHash: sha256 of package-lock.json. */
  repo: { head: string | null; lockHash: string; nodeModules: boolean };
  servicesRunning: boolean;
  start: boolean;
};

const GiB = 1024 ** 3;
export const ENV_BYTES = 12 * GiB;
export const CLONE_BYTES = 0.5 * GiB;
export const NPM_BYTES = 2 * GiB;
export const BUILD_BYTES = 1 * GiB;
export const MARGIN_BYTES = 2 * GiB;

export const OPEN_STACK_REPORT = 'apps/web/public/open-stack-report.json';
export const FETCH_WEIGHTS = 'infra/runpod/fetch-weights.ts';
export const CHECK_OPEN_STACK = 'tools/check-open-stack/src/cli.ts';

const gib = (bytes: number) => `${(bytes / GiB).toFixed(2)} GiB`;

export function envStamp(commit: string, torch: TorchPin, python: [number, number, number]): string {
  return `${commit} torch==${torch.torch}+${torch.cuda} torchvision==${torch.torchvision} python==${python[0]}.${python[1]}`;
}

/** The release file of yt-dlp for a system: the standalone binary, which needs no Python. */
export function ytDlpUrl(versions: Versions, os: Os): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/download/${versions.ytDlp.version}/${os === 'windows' ? 'yt-dlp.exe' : 'yt-dlp_linux'}`;
}

export function ytDlpStamp(versions: Versions, os: Os): string {
  return `yt-dlp==${versions.ytDlp.version} sha256:${versions.ytDlp.sha256[os]}`;
}

/** null outside a git checkout: the app is then rebuilt on every install. */
export function buildStamp(head: string | null, lockHash: string): string | null {
  return head ? `${head} ${lockHash}` : null;
}

/** The proxy venv depends on its Python too: removing that Python breaks the venv. null without a Python. */
export function proxyStamp(versions: Versions, python: [number, number, number] | null): string | null {
  return python ? `comfy-api-proxy==${versions.proxyVersion} python==${python[0]}.${python[1]}` : null;
}

/**
 * Weight files that cannot be the file the lock pins, removed before the download:
 * fetch-weights only hashes a file that exists, so it would fail on it at every run.
 * A file of another size, or the file Montagio recorded (same size and mtime) under
 * an older sha256. An unrecorded file of the right size is left for fetch-weights to hash.
 */
export function weightsToClear(lock: LockWeight[], state: InstallState, stat: (weight: LockWeight) => FileStat | null): LockWeight[] {
  return lock.filter((weight) => {
    const file = stat(weight);
    if (!file) return false;
    if (file.size !== weight.size) return true;
    const seen = state.weights[weight.id];
    return Boolean(seen && seen.sha256 !== weight.sha256 && seen.size === file.size && seen.mtimeMs === file.mtimeMs);
  });
}

/** A weight is fetched (or hashed again) unless the state saw these exact bytes: same sha256, size and mtime. */
export function weightsToFetch(lock: LockWeight[], state: InstallState, stat: (weight: LockWeight) => FileStat | null): LockWeight[] {
  return lock.filter((weight) => {
    const file = stat(weight);
    const seen = state.weights[weight.id];
    return !(file && seen && file.size === weight.size && seen.sha256 === weight.sha256 && seen.size === file.size && seen.mtimeMs === file.mtimeMs);
  });
}

export function samePath(a: string | null, b: string, os: Os): boolean {
  if (!a) return false;
  const path = pathFor(os);
  const norm = (p: string) => {
    const resolved = path.resolve(p.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '');
    return os === 'windows' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

export function buildPlan(input: PlanInput): Step[] {
  const { layout: L, versions, state, os } = input;
  const path = pathFor(os);
  const full = input.mode === 'full';
  const steps: Step[] = [];
  const add = (step: Step) => steps.push(step);
  const python = input.python?.command.join(' ') ?? '<no suitable Python>';

  add({
    id: 'stop-services',
    title: 'stop the running services',
    run: input.servicesRunning,
    why: input.servicesRunning ? 'Montagio is running: it is stopped first, Windows locks the files it uses' : 'nothing is running',
    detail: ['stop the app, comfy-api-proxy and ComfyUI'],
  });

  const npmStale = !input.repo.nodeModules || state.stamps.npm !== input.repo.lockHash;
  add({
    id: 'npm-ci',
    title: "install the app's npm dependencies",
    run: npmStale,
    why: !input.repo.nodeModules ? 'node_modules is missing' : !state.stamps.npm ? 'first install' : npmStale ? 'package-lock.json changed' : 'up to date',
    detail: [`npm ci --no-audit --no-fund (in ${input.repoRoot})`],
  });

  if (full) {
    const ours = Boolean(state.stamps.comfyui) || input.comfy.marked;
    if (input.comfy.exists && !ours) {
      throw new Error(`${L.comfyDir} exists and was not installed by Montagio: choose another --dir`);
    }
    const atPin = input.comfy.exists && input.comfy.head === versions.comfyuiCommit;
    const short = versions.comfyuiCommit.slice(0, 8);
    add({
      id: 'comfyui',
      title: `ComfyUI ${versions.comfyuiTag} (${short})`,
      run: !atPin,
      why: atPin ? 'up to date' : input.comfy.exists ? `at ${input.comfy.head?.slice(0, 8) ?? 'an unreadable commit'}: update to ${versions.comfyuiTag}` : 'not installed',
      detail: input.comfy.exists
        ? [
            `git -C ${L.comfyDir} status --porcelain (must be empty: local changes stop the update)`,
            `git -C ${L.comfyDir} fetch --depth 1 origin tag ${versions.comfyuiTag}`,
            `git -C ${L.comfyDir} checkout --detach ${versions.comfyuiCommit}`,
          ]
        : [
            ...(input.comfy.tmpExists ? [`remove ${L.comfyTmp} (left by an interrupted clone)`] : []),
            `git clone --depth 1 --branch ${versions.comfyuiTag} ${versions.comfyuiRepo} ${L.comfyTmp}`,
            `check that HEAD is ${versions.comfyuiCommit}`,
            `rename ${L.comfyTmp} to ${L.comfyDir}`,
          ],
    });

    const torch = input.torch;
    const env = torch && input.python ? envStamp(versions.comfyuiCommit, torch, input.python.version) : null;
    const envStale = env === null || state.stamps.comfyEnv !== env || !input.artifacts.comfyPython;
    const constraints = path.join(L.cacheDir, 'torch-constraints.txt');
    add({
      id: 'comfyui-env',
      title: torch ? `PyTorch ${torch.torch}+${torch.cuda} and ComfyUI's requirements` : "PyTorch and ComfyUI's requirements",
      run: envStale,
      why: !state.stamps.comfyEnv
        ? 'not installed'
        : !input.artifacts.comfyPython
          ? `missing: ${L.comfyPython}`
          : envStale
            ? 'ComfyUI, PyTorch or Python changed'
            : 'up to date',
      detail: [
        `${python} -m venv ${L.comfyVenv}`,
        `${L.comfyPython} -m pip install --upgrade pip`,
        torch
          ? `${L.comfyPython} -m pip install --index-url https://download.pytorch.org/whl/${torch.cuda} torch==${torch.torch} torchvision==${torch.torchvision}`
          : `${L.comfyPython} -m pip install torch torchvision (no PyTorch build fits this driver)`,
        `${L.comfyPython} -m pip install -r ${path.join(L.comfyDir, 'requirements.txt')} -c ${constraints}`,
        `${L.comfyPython} -I -c "import torch; assert torch.cuda.is_available()"`,
      ],
    });

    const proxy = proxyStamp(versions, input.python?.version ?? null);
    const proxyStale = proxy === null || state.stamps.proxy !== proxy || !input.artifacts.proxyExe;
    add({
      id: 'proxy',
      title: `comfy-api-proxy ${versions.proxyVersion}`,
      run: proxyStale,
      why: !state.stamps.proxy
        ? 'not installed'
        : !input.artifacts.proxyExe
          ? `missing: ${L.proxyExe}`
          : proxyStale
            ? 'new version, or another Python'
            : 'up to date',
      detail: [`${python} -m venv ${L.proxyVenv}`, `${L.proxyPython} -m pip install comfy-api-proxy==${versions.proxyVersion}`],
    });

    const packDir = path.join(input.repoRoot, 'comfy-nodes');
    // The run never replaces a real folder: the dry run says so too, instead of a [run].
    if (samePath(input.packTarget, L.packLink, os)) {
      throw new Error(`${L.packLink} is a folder, not a link to ${packDir}: move it away, then run the same command again`);
    }
    const linked = samePath(input.packTarget, packDir, os);
    add({
      id: 'node-pack',
      title: 'link the Montagio node pack into ComfyUI',
      run: !linked,
      why: linked ? 'already linked' : input.packTarget ? `points to ${input.packTarget}` : 'not linked',
      detail: [`${L.packLink} -> ${packDir} (${os === 'windows' ? 'junction' : 'symbolic link'})`],
    });

    const toFetch = weightsToFetch(input.lock, state, input.weightStat);
    const toClear = weightsToClear(input.lock, state, input.weightStat);
    const bytes = toFetch.reduce((sum, w) => sum + w.size, 0);
    add({
      id: 'weights',
      title: 'weights of registry/models.lock.yaml (resumable, sha256 checked)',
      run: toFetch.length > 0,
      why:
        toFetch.length === 0
          ? `all ${input.lock.length} files present and verified`
          : `${toFetch.length} of ${input.lock.length} files to fetch or check, up to ${gib(bytes)}`,
      detail: [
        ...toClear.map((w) => `remove ${path.join(L.modelsDir, w.folder, w.file)} (not the file the lock pins now)`),
        ...toFetch.map((w) => `${`${w.folder}/${w.file}`.padEnd(72)} ${gib(w.size).padStart(10)}`),
        `node ${FETCH_WEIGHTS} --models-dir ${L.modelsDir} --only ${toFetch.map((w) => w.id).join(',') || '-'} --out ${L.weightsOut}`,
      ],
    });
  }

  // The app imports a trend from its link with it, in either mode; the demo shows no link field.
  const ytDlp = ytDlpStamp(versions, os);
  const ytDlpStale = state.stamps.ytDlp !== ytDlp || !input.artifacts.ytDlp;
  add({
    id: 'yt-dlp',
    title: `yt-dlp ${versions.ytDlp.version} for the remix's import by link (sha256 checked)`,
    run: ytDlpStale,
    why: !state.stamps.ytDlp ? 'not installed' : !input.artifacts.ytDlp ? `missing: ${L.ytDlpExe}` : ytDlpStale ? 'new version' : 'up to date',
    detail: [`download ${ytDlpUrl(versions, os)}`, `check its sha256 is ${versions.ytDlp.sha256[os]}`, `write ${L.ytDlpExe}`],
  });

  add({
    id: 'open-stack',
    title: 'check-open-stack (no partner node, no closed API, only Apache-2.0 or MIT weights)',
    run: true,
    why: 'runs on every install',
    detail: [`node ${CHECK_OPEN_STACK} . --out ${OPEN_STACK_REPORT}`],
  });

  const build = buildStamp(input.repo.head, input.repo.lockHash);
  const buildStale = npmStale || build === null || state.stamps.build !== build || !input.artifacts.appBuild;
  add({
    id: 'app-build',
    title: 'build the app (next build)',
    run: buildStale,
    why:
      build === null
        ? 'not a git checkout: always rebuilt'
        : !state.stamps.build || !input.artifacts.appBuild
          ? 'not built yet'
          : buildStale
            ? 'the code or its dependencies changed'
            : 'up to date',
    detail: [`next build (in ${path.join(input.repoRoot, 'apps', 'web')})`],
  });

  add({ id: 'save-state', title: 'save the install state', run: true, why: 'mode, ports and GPU', detail: [`write ${L.statePath}`] });

  add({
    id: 'start',
    title: full ? 'start ComfyUI, comfy-api-proxy and the app' : 'start the app',
    run: input.start,
    why: input.start ? 'then open the browser' : '--no-start',
    detail: full
      ? [`ComfyUI on 127.0.0.1:${state.ports.comfy}`, `comfy-api-proxy on 127.0.0.1:${state.ports.proxy}`, `the app on http://127.0.0.1:${state.ports.app}`]
      : [
          `the app on http://127.0.0.1:${state.ports.app}`,
          state.proxyUrl ? `rendering through the comfy-api-proxy at ${state.proxyUrl} (--demo forgets it)` : 'demo mode: pre-rendered clips',
        ],
  });

  return steps;
}

/** onDisk: bytes of a weight already there (the whole file, or the .part a cut download left), never charged twice. */
export function diskNeed(steps: Step[], toFetch: LockWeight[], onDisk: (weight: LockWeight) => number): { installDir: number; repo: number } {
  const runs = (id: StepId) => steps.some((step) => step.id === id && step.run);
  return {
    installDir:
      toFetch.reduce((sum, w) => sum + Math.max(0, w.size - onDisk(w)), 0) + (runs('comfyui-env') ? ENV_BYTES : 0) + (runs('comfyui') ? CLONE_BYTES : 0) + MARGIN_BYTES,
    repo: (runs('npm-ci') ? NPM_BYTES : 0) + (runs('app-build') ? BUILD_BYTES : 0) + MARGIN_BYTES,
  };
}
