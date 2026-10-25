/**
 * The Montagio installer's command line, run by montagio.sh and montagio.ps1:
 *   install   check the machine, install what is missing, start Montagio
 *   start     start ComfyUI, comfy-api-proxy and the app, open the browser
 *   stop      stop them
 *   status    say what runs
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import type { Ports } from './checks.ts';
import { capture, stream } from './exec.ts';
import { install } from './install.ts';
import { defaultInstallDir, layout, osOf } from './platform.ts';
import { probe } from './probe.ts';
import { runningPorts, startAll, status, stopAll, type ServiceContext } from './services.ts';
import { readState } from './state.ts';

export const USAGE = `Usage: ./montagio.sh <command> [options]           (Linux)
       powershell -ExecutionPolicy Bypass -File .\\montagio.ps1 <command> [options]   (Windows)

Commands:
  install        check this machine, install what is missing or out of date, then start Montagio
  start          start ComfyUI, comfy-api-proxy and the app, then open the browser
  stop           stop them
  status         say what runs, where, and where the logs are
  help           this text

Options:
  --dry-run          install: show the checks and every step, change nothing
  --app-only         install the app alone: no ComfyUI, no weights (demo mode, or --proxy-url)
  --proxy-url URL    with --app-only: the comfy-api-proxy of a remote GPU (for example an SSH tunnel), kept for the next runs
  --demo             with --app-only: forget a saved --proxy-url, run the demo mode
  --low-vram         install the 12 GB profile (12 to 20 GB cards): only what a GPU session ran within 12 GB,
                     slower renders; offered on such a card, kept for the next runs
  --ignore-vram      install even on a GPU under 12 GB, or every model under 24 GB (renders may run out of memory)
  --dir DIR          install folder (default: %LOCALAPPDATA%\\Montagio or ~/.local/share/montagio, or MONTAGIO_HOME)
  --comfy-port N     install: ComfyUI port (default 8188), kept for the next runs
  --proxy-port N     install: comfy-api-proxy port (default 8189)
  --app-port N       install: app port (default 3000)
  --no-start         install: do not start Montagio at the end
  --no-browser       install, start: do not open the browser
  --extensions LIST  install: the extensions whose weights to fetch besides the camera presets': all (every one,
                     the node packs of the avatar and the object swap included), validated (those a GPU session
                     validated), none, or a list such as music,edit. Default: the effects pack (about 21 GB), once a
                     GPU session validated it

Environment:
  MONTAGIO_EXTENSIONS     install: the default of --extensions (the app reads it too)
  MONTAGIO_COMFYUI_ARGS   extra ComfyUI arguments, for example "--reserve-vram 1"
  HF_TOKEN               Hugging Face token, only if a download is refused
  MONTAGIO_FFMPEG, MONTAGIO_FFPROBE   FFmpeg binaries outside the PATH
  MONTAGIO_YTDLP          another yt-dlp for the remix's import by link than the one the installer pins

Guide: docs/INSTALL.md`;

export type Command = 'install' | 'start' | 'stop' | 'status' | 'help';
export type CliOptions = {
  dryRun: boolean;
  appOnly: boolean;
  ignoreVram: boolean;
  dir: string | null;
  start: boolean;
  browser: boolean;
  proxyUrl: string | null;
  demo: boolean;
  ports: Partial<Ports>;
  /** --extensions; null leaves it to MONTAGIO_EXTENSIONS, then the effects pack if a GPU session validated it. */
  extensions: string | null;
  /** --low-vram: the 12 GB profile. */
  lowVram: boolean;
};

const COMMANDS: Command[] = ['install', 'start', 'stop', 'status', 'help'];
const PORT_FLAGS = { comfy: 'comfy-port', proxy: 'proxy-port', app: 'app-port' } as const;
/** The options each command reads: another one is refused, not ignored (start --dry-run would start). */
const COMMAND_OPTIONS: Record<Exclude<Command, 'help'>, string[]> = {
  install: ['dry-run', 'app-only', 'low-vram', 'ignore-vram', 'no-start', 'no-browser', 'dir', 'proxy-url', 'demo', 'comfy-port', 'proxy-port', 'app-port', 'extensions'],
  start: ['dir', 'no-browser'],
  stop: ['dir'],
  status: ['dir'],
};

export function parseArgs(argv: string[]): { command: Command; options: CliOptions } {
  let parsed: ReturnType<typeof parseNodeArgs<{ options: Record<string, { type: 'string' | 'boolean' }>; allowPositionals: true; strict: true }>>;
  try {
    parsed = parseNodeArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        'dry-run': { type: 'boolean' },
        'app-only': { type: 'boolean' },
        'ignore-vram': { type: 'boolean' },
        'low-vram': { type: 'boolean' },
        'no-start': { type: 'boolean' },
        'no-browser': { type: 'boolean' },
        dir: { type: 'string' },
        'proxy-url': { type: 'string' },
        demo: { type: 'boolean' },
        'comfy-port': { type: 'string' },
        'proxy-port': { type: 'string' },
        'app-port': { type: 'string' },
        extensions: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new Error((error as Error).message.replace(/^Unknown option '(.*?)'.*$/s, 'unknown option $1'));
  }
  const values = parsed.values as Record<string, string | boolean | undefined>;
  const [name = 'help', ...extra] = parsed.positionals;
  if (!COMMANDS.includes(name as Command)) throw new Error(`unknown command "${name}" (expected ${COMMANDS.join(', ')})`);
  if (extra.length > 0) throw new Error(`unexpected argument "${extra[0]}"`);
  if (name !== 'help' && !values.help) {
    for (const flag of Object.keys(values)) {
      if (flag === 'help' || COMMAND_OPTIONS[name as keyof typeof COMMAND_OPTIONS].includes(flag)) continue;
      const commands = Object.entries(COMMAND_OPTIONS).filter(([, flags]) => flags.includes(flag)).map(([command]) => command);
      throw new Error(`--${flag} only goes with ${commands.join(' or ')}`);
    }
  }

  const ports: Partial<Ports> = {};
  for (const [key, flag] of Object.entries(PORT_FLAGS) as [keyof Ports, string][]) {
    const raw = values[flag];
    if (raw === undefined) continue;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--${flag} must be a port number from 1 to 65535, got "${raw}"`);
    ports[key] = port;
  }
  const proxyUrl = typeof values['proxy-url'] === 'string' ? values['proxy-url'] : null;
  if (proxyUrl !== null) {
    if (!values['app-only']) throw new Error('--proxy-url only goes with --app-only (the full install runs its own proxy)');
    let protocol = '';
    try {
      protocol = new URL(proxyUrl).protocol;
    } catch {
      protocol = '';
    }
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`--proxy-url must be an http(s) URL, got "${proxyUrl}"`);
  }
  if (values['low-vram'] && values['app-only']) throw new Error('--low-vram is a profile of the full install, not of --app-only');
  if (values.demo) {
    if (!values['app-only']) throw new Error('--demo only goes with --app-only (the full install renders on this machine)');
    if (proxyUrl !== null) throw new Error('--demo and --proxy-url do not go together: --demo forgets the proxy URL');
  }
  return {
    command: values.help ? 'help' : (name as Command),
    options: {
      dryRun: Boolean(values['dry-run']),
      appOnly: Boolean(values['app-only']),
      ignoreVram: Boolean(values['ignore-vram']),
      dir: typeof values.dir === 'string' ? values.dir : null,
      start: !values['no-start'],
      browser: !values['no-browser'],
      proxyUrl,
      demo: Boolean(values.demo),
      ports,
      extensions: typeof values.extensions === 'string' ? values.extensions : null,
      lowVram: Boolean(values['low-vram']),
    },
  };
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`error: ${(error as Error).message}\n(run "help" for the usage)`);
    return 2;
  }
  const { command, options } = parsed;
  if (command === 'help') {
    console.log(USAGE);
    return 0;
  }
  const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const os = osOf(process.platform);
  const dir = resolve(options.dir ?? defaultInstallDir(os ?? 'linux', process.env, homedir()));
  const log = (line: string) => console.log(line);
  const L = layout(dir, os ?? 'linux');
  // Read the state at each call: install writes it (save-state) right before it starts the services.
  const services = (): ServiceContext => ({ os: os ?? 'linux', layout: L, repoRoot, state: readState(L.statePath), capture, log });

  if (command === 'start') return startAll(services(), { browser: options.browser });
  if (command === 'stop') {
    await stopAll(services());
    return 0;
  }
  if (command === 'status') {
    log(await status(services()));
    return 0;
  }
  return install(
    repoRoot,
    {
      dir,
      mode: options.appOnly ? 'app-only' : 'full',
      ignoreVram: options.ignoreVram,
      ports: options.ports,
      proxyUrl: options.proxyUrl,
      demo: options.demo,
      dryRun: options.dryRun,
      start: options.start,
      browser: options.browser,
      extensions: options.extensions,
      lowVram: options.lowVram,
    },
    {
      capture,
      stream,
      log,
      ask: process.stdin.isTTY && process.stdout.isTTY ? askYesNo : null,
      probe,
      download: downloadBytes,
      runningPorts: () => runningPorts(services()),
      stopAll: () => stopAll(services()),
      startAll: (opts) => startAll(services(), opts),
    },
  );
}

/**
 * The arguments. montagio.ps1 sends them as JSON in MONTAGIO_ARGV: Windows
 * PowerShell 5.1 splits an argument that starts with "-" and holds a space
 * ("--dir=C:\Montagio Data") when it passes it to a program.
 */
export function argvFrom(env: Record<string, string | undefined>, argv: string[]): string[] {
  const raw = env.MONTAGIO_ARGV;
  if (!raw) return argv;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === 'string')) throw new Error('MONTAGIO_ARGV must be a JSON list of strings');
  return parsed;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const argv = argvFrom(process.env, process.argv.slice(2));
  // Not for the programs the installer starts.
  delete process.env.MONTAGIO_ARGV;
  main(argv).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`error: ${(error as Error).stack ?? error}`);
      process.exitCode = 1;
    },
  );
}

/** A release file, followed through its redirects; refused unless the server answers 200. */
async function downloadBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
