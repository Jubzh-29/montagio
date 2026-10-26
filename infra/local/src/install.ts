/**
 * `install`: probe the machine, judge it, plan, then run the plan step by
 * step (or only print it with --dry-run). Each step writes its stamp as soon
 * as it succeeds; a failed step stops the run, and running the same command
 * again picks up from there.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decide, evaluate, MIN_VRAM_MIB, pickGpu, pickPython, pickTorch, type Check, type Decision, type Mode, type Ports, type VramProfile } from './checks.ts';
import { npmInvocation, nextBin, tsxCli, type Capture, type Stream } from './exec.ts';
import { installDefaultExtensions, readExtensions, readLock, readVersions, selectExtensions, weightsFor, type LockWeight } from './pins.ts';
import {
  buildPlan,
  buildStamp,
  CHECK_OPEN_STACK,
  diskNeed,
  envStamp,
  FETCH_WEIGHTS,
  nodePacksFor,
  OPEN_STACK_REPORT,
  proxyStamp,
  VOICE_NODE_IMPORTS,
  VOICE_NODE_PATCH,
  VOICE_NODE_REQUIREMENTS,
  voiceWheelsFit,
  weightsToClear,
  weightsToFetch,
  ytDlpStamp,
  ytDlpUrl,
  type FileStat,
  type NodePackId,
  type Step,
  type StepId,
} from './plan.ts';
import { layout, osOf, withoutVars, type Os } from './platform.ts';
import type { probe as probeMachine } from './probe.ts';
import { readState, recordWeights, writeState, type InstallState } from './state.ts';

export type InstallOptions = {
  dir: string;
  mode: Mode;
  ignoreVram: boolean;
  ports: Partial<Ports>;
  /** null keeps the saved one; demo forgets it. */
  proxyUrl: string | null;
  demo: boolean;
  dryRun: boolean;
  start: boolean;
  browser: boolean;
  /** --extensions: whose weights to fetch besides the camera presets'; null or absent reads MONTAGIO_EXTENSIONS, then the effects pack if validated. */
  extensions?: string | null;
  /** --low-vram: the 12 GB profile, asked for; otherwise the saved profile, or the one the GPU allows once accepted. */
  lowVram?: boolean;
};

export type InstallDeps = {
  capture: Capture;
  stream: Stream;
  log: (line: string) => void;
  /** null without a terminal: an offer is then refused and the run stops. */
  ask: ((question: string) => Promise<boolean>) | null;
  stopAll: () => Promise<void>;
  startAll: (opts: { browser: boolean }) => Promise<number>;
  /** Ports of the Montagio services running now (their pid is alive and theirs). */
  runningPorts: () => Promise<number[]>;
  probe: typeof probeMachine;
  /** The bytes behind a URL (yt-dlp's release file): checked by their sha256 before anything is written. */
  download: (url: string) => Promise<Uint8Array>;
  os?: Os;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
};

const LABEL = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;
/** What a node pack's folder holds once installed, as infra/runpod/bootstrap.sh writes it. */
const NODE_STAMP = '.montagio-stamp';
/** Where a node pack is made before it goes into custom_nodes: beside ComfyUI's folders, where ComfyUI loads nothing. */
const buildDirOf = (dir: string) => join(dirname(dirname(dir)), '.montagio-build', basename(dir));
const CUDA_CHECK =
  'import torch; assert torch.cuda.is_available(), "torch sees no CUDA device"; ' +
  'print(f"[montagio] torch {torch.__version__} (CUDA {torch.version.cuda}) on {torch.cuda.get_device_name(0)}")';

export function renderReport(
  checks: Check[],
  decision: Decision,
  steps: Step[],
  ctx: { dir: string; dryRun: boolean; mode: Mode; profile?: VramProfile },
): string {
  const lines = [`Montagio installer${ctx.dryRun ? ' (dry run: nothing will be changed)' : ''}`, `Install folder: ${ctx.dir}`, '', 'Machine'];
  for (const check of checks) {
    lines.push(`  ${LABEL[check.severity]}  ${check.id.padEnd(7)} ${check.message}`);
    if (check.fix && check.severity !== 'ok') lines.push(`${' '.repeat(16)}-> ${check.fix}`);
  }
  lines.push('', `Plan (${ctx.mode === 'full' ? (ctx.profile === '12gb' ? 'full install, 12 GB profile' : 'full install') : 'app only'})`);
  steps.forEach((step, index) => {
    lines.push(`  ${String(index + 1).padStart(2)}. [${step.run ? 'run' : 'skip'}]${step.run ? ' ' : ''} ${step.id.padEnd(13)} ${step.title} (${step.why})`);
    if (step.run) for (const line of step.detail) lines.push(`${' '.repeat(14)}${line}`);
  });
  lines.push('');
  if (decision.kind === 'offer-low-vram') {
    lines.push(
      `This GPU cannot run every model: ${decision.reason}.`,
      'Montagio can install its 12 GB profile: the models and extensions a GPU session ran within 12 GB, with slower renders. Run the same command with --low-vram.',
    );
  } else if (decision.kind === 'offer-app-only') {
    lines.push(
      `This machine cannot run the video models: ${decision.reason}.`,
      'Montagio can install the app alone (demo mode, or a remote GPU with --proxy-url): run the same command with --app-only.',
    );
  } else if (decision.kind === 'stop') {
    lines.push('Stopped: fix the FAIL lines above, then run the same command again.');
  }
  // Paths can hold non-ASCII letters; the rest stays ASCII for old Windows consoles.
  return lines.join('\n');
}

/** The file that says a ComfyUI folder is Montagio's, should install-state.json be lost. */
export const OWNER_MARKER = '.montagio';

/** Marks a Montagio clone as ours. git is told to ignore the marker: an update refuses a non-empty `git status`. */
export function markOwned(clone: string): void {
  writeFileSync(join(clone, OWNER_MARKER), 'This ComfyUI was installed by Montagio: its install command updates it.\n');
  mkdirSync(join(clone, '.git', 'info'), { recursive: true });
  appendFileSync(join(clone, '.git', 'info', 'exclude'), `\n/${OWNER_MARKER}\n`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function statOrNull(path: string): FileStat | null {
  try {
    const stats = statSync(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

function readLink(path: string): string | null {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : path;
  } catch {
    return null;
  }
}

/**
 * A build next start can serve: a BUILD_ID, and not a static export. The showcase build
 * (npm run showcase:build) exports into the same .next, with output: 'export' in its config.
 */
function servedBuild(nextDir: string): boolean {
  if (!existsSync(join(nextDir, 'BUILD_ID'))) return false;
  try {
    const files = JSON.parse(readFileSync(join(nextDir, 'required-server-files.json'), 'utf8')) as { config?: { output?: string } };
    return files.config?.output !== 'export';
  } catch {
    return true;
  }
}

/** Major and minor of the Python a venv was made with, from its pyvenv.cfg. */
function venvPython(venv: string): string | null {
  try {
    const cfg = readFileSync(join(venv, 'pyvenv.cfg'), 'utf8');
    const match = /^version(?:_info)?\s*=\s*(\d+\.\d+)/m.exec(cfg);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

export async function install(repoRoot: string, opts: InstallOptions, deps: InstallDeps): Promise<number> {
  const os = deps.os ?? osOf(process.platform);
  const L = layout(opts.dir, os ?? 'linux');
  const env: NodeJS.ProcessEnv = {
    ...withoutVars(deps.env ?? process.env, ['COMFY_API_KEY'], os ?? 'linux'),
    NEXT_TELEMETRY_DISABLED: '1',
    CUDA_DEVICE_ORDER: 'PCI_BUS_ID',
  };
  const execPath = deps.execPath ?? process.execPath;
  const versions = readVersions(repoRoot);
  let state: InstallState = readState(L.statePath);
  // The 12 GB profile once asked for (--low-vram, or accepted on a 12 to 20 GB card) stays for the next runs, on that card.
  let profile: VramProfile = opts.lowVram || state.vramProfile === '12gb' ? '12gb' : 'standard';
  const flag = opts.extensions ?? env.MONTAGIO_EXTENSIONS;
  const config = readExtensions(repoRoot);
  const extensionsFor = (asked: VramProfile) => (flag?.trim() ? selectExtensions(config, flag, asked) : installDefaultExtensions(config, asked));
  let enabled: string[];
  try {
    enabled = extensionsFor(profile);
  } catch (error) {
    deps.log(`error: ${(error as Error).message}`);
    return 2;
  }

  // The weights of the extensions nobody asked for stay out of the plan and of the disk check.
  const fullLock = readLock(repoRoot);
  let lock = weightsFor(fullLock, enabled);
  const ports: Ports = { ...state.ports, ...opts.ports };
  const proxyUrl = opts.demo ? null : (opts.proxyUrl ?? state.proxyUrl);
  const own = await deps.runningPorts();
  const facts = await deps.probe({ os, repoRoot, installDir: opts.dir, ports: [ports.comfy, ports.proxy, ports.app], capture: deps.capture });
  // A saved 12 GB profile ends on a 24 GB card (a new GPU): every model comes back, unless --low-vram asks again.
  if (profile === '12gb' && !opts.lowVram && (pickGpu(facts.gpus)?.vramMiB ?? 0) >= MIN_VRAM_MIB) {
    profile = 'standard';
    try {
      enabled = extensionsFor(profile);
    } catch (error) {
      deps.log(`error: ${(error as Error).message}`);
      return 2;
    }
    lock = weightsFor(fullLock, enabled);
  }

  const gitHead = async (where: string) => {
    const answer = await deps.capture('git', ['-C', where, 'rev-parse', 'HEAD']);
    return answer.code === 0 ? answer.stdout.trim() || null : null;
  };
  const weightStat = (w: LockWeight) => statOrNull(join(L.modelsDir, w.folder, w.file));
  // Bytes already there: the whole file, or what a cut download left in <file>.part (fetch-weights resumes it).
  const onDisk = (w: LockWeight) => {
    const file = weightStat(w);
    if (file) return file.size === w.size ? w.size : 0;
    return statOrNull(join(L.modelsDir, w.folder, `${w.file}.part`))?.size ?? 0;
  };
  // What each node pack's folder holds, and the hash of the voice pack's patch and requirements (a new one installs it again).
  const stampIn = (dir: string) => {
    try {
      return readFileSync(join(dir, NODE_STAMP), 'utf8').trim() || null;
    } catch {
      return null;
    }
  };
  const nodeDirs: Record<NodePackId, string> = { voice: L.voiceNodeDir, segment: L.segmentNodeDir };
  const nodeStamps = { voice: stampIn(L.voiceNodeDir), segment: stampIn(L.segmentNodeDir) };
  const voiceExtras = createHash('sha256')
    .update(readFileSync(join(repoRoot, VOICE_NODE_PATCH)))
    .update(readFileSync(join(repoRoot, VOICE_NODE_REQUIREMENTS)))
    .digest('hex')
    .slice(0, 16);
  const comfyExists = existsSync(L.comfyDir);
  const comfy = {
    exists: comfyExists,
    tmpExists: existsSync(L.comfyTmp),
    head: comfyExists ? await gitHead(L.comfyDir) : null,
    marked: comfyExists && existsSync(join(L.comfyDir, OWNER_MARKER)),
  };
  const repo = {
    head: await gitHead(repoRoot),
    lockHash: sha256(join(repoRoot, 'package-lock.json')),
    nodeModules: existsSync(join(repoRoot, 'node_modules', '.package-lock.json')),
  };

  const planFor = (mode: Mode) => {
    const torch = pickTorch(facts.driverCuda, versions);
    const python = pickPython(facts.pythons);
    const steps = buildPlan({
      os: os ?? 'linux',
      mode,
      layout: L,
      repoRoot,
      versions,
      torch,
      python,
      state: { ...state, ports, proxyUrl },
      lock,
      weightStat,
      comfy,
      packTarget: readLink(L.packLink),
      extensions: mode === 'full' ? enabled : [],
      nodeStamps,
      voiceExtras,
      artifacts: {
        comfyPython: existsSync(L.comfyPython),
        proxyExe: existsSync(L.proxyExe),
        appBuild: servedBuild(join(repoRoot, 'apps', 'web', '.next')),
        ytDlp: existsSync(L.ytDlpExe),
      },
      repo,
      servicesRunning: own.length > 0,
      start: opts.start,
    });
    const toFetch = mode === 'full' ? weightsToFetch(lock, state, weightStat) : [];
    const checks = evaluate(facts, { mode, versions, ports, ownPorts: own, need: diskNeed(steps, toFetch, onDisk), ignoreVram: opts.ignoreVram, profile });
    return { mode, steps, checks, decision: decide(checks, mode), toFetch, torch, python };
  };

  let plan: ReturnType<typeof planFor>;
  try {
    plan = planFor(opts.mode);
  } catch (error) {
    deps.log(`error: ${(error as Error).message}`);
    return 2;
  }
  deps.log(renderReport(plan.checks, plan.decision, plan.steps, { dir: opts.dir, dryRun: opts.dryRun, mode: plan.mode, profile }));

  if (plan.decision.kind === 'offer-low-vram') {
    if (opts.dryRun || !deps.ask) return 2;
    if (!(await deps.ask('Install the 12 GB profile instead (slower renders, the models validated on a 12 GB card)? [y/N] '))) return 2;
    profile = '12gb';
    enabled = extensionsFor(profile);
    lock = weightsFor(fullLock, enabled);
    plan = planFor('full');
    deps.log(renderReport(plan.checks, plan.decision, plan.steps, { dir: opts.dir, dryRun: false, mode: plan.mode, profile }));
  }
  if (plan.decision.kind === 'offer-app-only') {
    if (opts.dryRun || !deps.ask) return 2;
    if (!(await deps.ask(`Install the app alone instead (demo mode, or a remote GPU with --proxy-url)? [y/N] `))) return 2;
    plan = planFor('app-only');
    deps.log(renderReport(plan.checks, plan.decision, plan.steps, { dir: opts.dir, dryRun: false, mode: plan.mode }));
  }
  if (plan.decision.kind !== 'proceed') return 2;
  if (opts.dryRun) {
    deps.log('Dry run: nothing was changed.');
    return 0;
  }

  const save = (next: InstallState) => {
    state = next;
    writeState(L.statePath, state);
  };
  const stamp = (id: keyof InstallState['stamps'], value: string) => save({ ...state, stamps: { ...state.stamps, [id]: value } });
  const run = async (cmd: string, args: string[], o: { cwd?: string; shell?: boolean; env?: NodeJS.ProcessEnv } = {}) => {
    const code = await deps.stream(cmd, args, { cwd: o.cwd, env: o.env ?? env, shell: o.shell });
    if (code !== 0) throw new Error(`${basename(cmd)} ${args.slice(0, 3).join(' ')} ... exited with code ${code}`);
  };
  const { torch, python } = plan;

  /** A node pack cloned at its pinned commit (the voice pack patched, its packages installed and imported), then stamped. */
  const installNodePack = async (id: NodePackId, dir: string, want: string) => {
    const pin = id === 'voice' ? versions.voiceNode : versions.segmentNode;
    if (id === 'voice' && python && !voiceWheelsFit(os ?? 'linux', python.version)) {
      throw new Error(`the avatar's voice node has its packages for Python 3.12 on Windows (3.10 to 3.13 on Linux), not ${python.version[0]}.${python.version[1]}`);
    }
    if (existsSync(dir) && !existsSync(join(dir, '.git'))) {
      throw new Error(`${dir} is a folder Montagio did not clone: move it away, then run the same command again`);
    }
    // Made outside custom_nodes, then moved in whole: ComfyUI never loads a pack half made, even after a Ctrl+C
    // (an unpatched voice pack would open its /chatterbox/* routes).
    const build = buildDirOf(dir);
    rmSync(build, { recursive: true, force: true });
    mkdirSync(dirname(build), { recursive: true });
    await run('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', pin.repo, build]);
    await run('git', ['-C', build, '-c', 'core.autocrlf=false', 'checkout', '--quiet', '--force', pin.commit]);
    const head = await gitHead(build);
    if (head !== pin.commit) throw new Error(`${pin.repo} is at ${head ?? 'an unreadable commit'}, expected ${pin.commit}`);
    if (id === 'voice') {
      const patch = join(repoRoot, VOICE_NODE_PATCH);
      await run('git', ['-C', build, 'apply', '--check', '--ignore-whitespace', patch]);
      await run('git', ['-C', build, 'apply', '--ignore-whitespace', patch]);
      await run(L.comfyPython, ['-m', 'pip', 'install', '--no-deps', '--require-hashes', '-r', join(repoRoot, VOICE_NODE_REQUIREMENTS)]);
      await run(L.comfyPython, ['-I', '-c', VOICE_NODE_IMPORTS]);
    }
    writeFileSync(join(build, NODE_STAMP), `${want}\n`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(build, dir);
  };

  const actions: Record<StepId, () => Promise<number | void>> = {
    'stop-services': () => deps.stopAll(),
    'npm-ci': async () => {
      const npm = npmInvocation(execPath, os ?? 'linux', env, existsSync);
      await run(npm.cmd, [...npm.args, 'ci', '--no-audit', '--no-fund'], { cwd: repoRoot, shell: npm.shell });
      stamp('npm', repo.lockHash);
    },
    comfyui: async () => {
      if (comfy.exists) {
        const status = await deps.capture('git', ['-C', L.comfyDir, 'status', '--porcelain']);
        if (status.code !== 0) {
          // A dubious-ownership refusal or a broken .git is not a local change: say what git said.
          const why = status.stderr.trim() || (status.code === null ? 'git did not run' : `exit code ${status.code}`);
          throw new Error(`git status failed in ${L.comfyDir}: ${why}`);
        }
        if (status.stdout.trim()) throw new Error(`${L.comfyDir} has local changes: move them away, then run the same command again`);
        await run('git', ['-C', L.comfyDir, 'fetch', '--depth', '1', 'origin', 'tag', versions.comfyuiTag]);
        await run('git', ['-C', L.comfyDir, 'checkout', '--detach', versions.comfyuiCommit]);
      } else {
        rmSync(L.comfyTmp, { recursive: true, force: true });
        mkdirSync(L.dir, { recursive: true });
        await run('git', ['clone', '--depth', '1', '--branch', versions.comfyuiTag, versions.comfyuiRepo, L.comfyTmp]);
        const head = await gitHead(L.comfyTmp);
        if (head !== versions.comfyuiCommit) throw new Error(`the clone is at ${head}, expected ${versions.comfyuiCommit} (${versions.comfyuiTag})`);
        // Before the rename: a Ctrl+C between the rename and the stamp leaves a folder that still says it is ours.
        markOwned(L.comfyTmp);
        renameSync(L.comfyTmp, L.comfyDir);
      }
      const head = await gitHead(L.comfyDir);
      if (head !== versions.comfyuiCommit) throw new Error(`${L.comfyDir} is at ${head}, expected ${versions.comfyuiCommit}`);
      stamp('comfyui', versions.comfyuiCommit);
    },
    'comfyui-env': async () => {
      if (!torch || !python) throw new Error('no PyTorch build or Python fits this machine');
      const wanted = `${python.version[0]}.${python.version[1]}`;
      const made = venvPython(L.comfyVenv);
      if (made && made !== wanted) rmSync(L.comfyVenv, { recursive: true, force: true });
      const [py, ...pre] = python.command;
      await run(py!, [...pre, '-m', 'venv', L.comfyVenv]);
      await run(L.comfyPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
      await run(L.comfyPython, ['-m', 'pip', 'install', '--index-url', `https://download.pytorch.org/whl/${torch.cuda}`, `torch==${torch.torch}`, `torchvision==${torch.torchvision}`]);
      // The constraint stops pip from swapping the CUDA build above for a PyPI one, and lifts the Pillow that came with it.
      const constraints = join(L.cacheDir, 'torch-constraints.txt');
      mkdirSync(L.cacheDir, { recursive: true });
      writeFileSync(constraints, `torch==${torch.torch}\ntorchvision==${torch.torchvision}\npillow>=${versions.pillowMin}; python_version >= "3.11"\n`);
      await run(L.comfyPython, ['-m', 'pip', 'install', '-r', join(L.comfyDir, 'requirements.txt'), '-c', constraints]);
      // The GPU the checks chose, numbered as nvidia-smi numbers it.
      await run(L.comfyPython, ['-I', '-c', CUDA_CHECK], { env: { ...env, CUDA_VISIBLE_DEVICES: String(pickGpu(facts.gpus)?.index ?? 0) } });
      stamp('comfyEnv', envStamp(versions.comfyuiCommit, torch, python.version, versions.pillowMin));
    },
    proxy: async () => {
      if (!python) throw new Error('no suitable Python');
      const made = venvPython(L.proxyVenv);
      if (made && made !== `${python.version[0]}.${python.version[1]}`) rmSync(L.proxyVenv, { recursive: true, force: true });
      const [py, ...pre] = python.command;
      await run(py!, [...pre, '-m', 'venv', L.proxyVenv]);
      await run(L.proxyPython, ['-m', 'pip', 'install', `comfy-api-proxy==${versions.proxyVersion}`]);
      stamp('proxy', proxyStamp(versions, python.version)!);
    },
    'node-pack': async () => {
      const target = join(repoRoot, 'comfy-nodes');
      const current = lstatSync(L.packLink, { throwIfNoEntry: false });
      if (current?.isSymbolicLink()) unlinkSync(L.packLink);
      else if (current) throw new Error(`${L.packLink} is a folder, not a link to ${target}: move it away, then run the same command again`);
      mkdirSync(dirname(L.packLink), { recursive: true });
      symlinkSync(target, L.packLink, os === 'windows' ? 'junction' : 'dir');
    },
    weights: async () => {
      // fetch-weights only hashes a file that exists: a file the lock no longer pins would fail at every run.
      const stale = weightsToClear(lock, state, weightStat);
      if (stale.length > 0) {
        const weights = { ...state.weights };
        for (const w of stale) {
          const file = join(L.modelsDir, w.folder, w.file);
          deps.log(`removing ${file}: not the file the lock pins now`);
          rmSync(file, { force: true });
          delete weights[w.id];
        }
        save({ ...state, weights });
      }
      // A node pack that failed left its extension out, and its weights with it.
      const ids = plan.toFetch.filter((w) => lock.some((kept) => kept.id === w.id)).map((w) => w.id);
      if (ids.length === 0) return;
      const report = join(L.weightsOut, 'weights-report.json');
      rmSync(report, { force: true });
      const code = await deps.stream(execPath, [tsxCli(repoRoot), FETCH_WEIGHTS, '--models-dir', L.modelsDir, '--only', ids.join(','), '--out', L.weightsOut], {
        cwd: repoRoot,
        env,
      });
      // Keep what was verified even when a file failed: the next run fetches only the rest.
      if (existsSync(report)) {
        const parsed = JSON.parse(readFileSync(report, 'utf8')) as Parameters<typeof recordWeights>[1];
        save(recordWeights(state, parsed, lock, (id) => weightStat(lock.find((w) => w.id === id)!)));
      }
      if (code !== 0) throw new Error('some weights failed (see above): run the same command again, downloads resume where they stopped');
    },
    'yt-dlp': async () => {
      const system = os ?? 'linux';
      const bytes = await deps.download(ytDlpUrl(versions, system));
      const got = createHash('sha256').update(bytes).digest('hex');
      const pinned = versions.ytDlp.sha256[system];
      if (got !== pinned) throw new Error(`yt-dlp: the file downloaded has the sha256 ${got}, not the pinned ${pinned}: nothing was written`);
      mkdirSync(dirname(L.ytDlpExe), { recursive: true });
      writeFileSync(`${L.ytDlpExe}.part`, bytes, { mode: 0o755 });
      renameSync(`${L.ytDlpExe}.part`, L.ytDlpExe);
      stamp('ytDlp', ytDlpStamp(versions, system));
    },
    'extension-nodes': async () => {
      for (const pack of nodePacksFor({ extensions: enabled, versions, voiceExtras })) {
        if (nodeStamps[pack.id] === pack.want) continue;
        const dir = nodeDirs[pack.id];
        try {
          await installNodePack(pack.id, dir, pack.want);
          stamp(pack.id === 'voice' ? 'voiceNode' : 'segmentNode', pack.want);
        } catch (error) {
          // What was made of it goes. A pack Montagio installed before (stamped, so patched) stays as it was; a clone
          // without its stamp, from elsewhere, may be the unpatched voice pack with its /chatterbox/* routes: it goes too.
          rmSync(buildDirOf(dir), { recursive: true, force: true });
          if (existsSync(join(dir, '.git')) && stampIn(dir) === null) rmSync(dir, { recursive: true, force: true });
          deps.log(`warning: ${(error as Error).message}; the ${pack.extension === 'avatar' ? 'avatar' : 'object swap'} extension is left out, the rest of the install goes on`);
          enabled = enabled.filter((id) => id !== pack.extension);
          lock = weightsFor(fullLock, enabled);
        }
      }
    },
    'open-stack': () => run(execPath, [tsxCli(repoRoot), CHECK_OPEN_STACK, '.', '--out', OPEN_STACK_REPORT], { cwd: repoRoot }),
    'app-build': async () => {
      await run(execPath, [nextBin(repoRoot), 'build'], { cwd: join(repoRoot, 'apps', 'web') });
      const build = buildStamp(repo.head, repo.lockHash);
      if (build) stamp('build', build);
    },
    'save-state': async () =>
      save({
        ...state,
        mode: plan.mode,
        ports,
        gpuIndex: plan.mode === 'full' ? (pickGpu(facts.gpus)?.index ?? null) : null,
        proxyUrl,
        extensions: plan.mode === 'full' ? enabled : null,
        vramProfile: plan.mode === 'full' ? profile : null,
      }),
    start: () => deps.startAll({ browser: opts.browser }),
  };

  for (const step of plan.steps) {
    if (!step.run) continue;
    deps.log(`\n==> ${step.title}`);
    try {
      const code = await actions[step.id]();
      if (typeof code === 'number' && code !== 0) return code;
    } catch (error) {
      deps.log(`error: ${(error as Error).message}`);
      return 1;
    }
  }
  return 0;
}
