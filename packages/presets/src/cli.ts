/**
 * Montagio command line (spec §4.3).
 *
 *   npm run montagio -- preset validate presets/my-move.yaml
 *   npm run montagio -- preset validate presets          # every *.yaml / *.yml in a folder
 *
 * Exit code: 0 when every file is valid, 1 when one is not, 2 on a usage error.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LibraryError, loadLibrary } from './library';
import { validatePreset } from './validate';

export type CliIo = { cwd: string; root: string; out(line: string): void; err(line: string): void };

const USAGE = 'Usage: montagio preset validate <file|folder>...';

/** The preset files an argument names: the file itself, or the *.yaml / *.yml of a folder. */
async function presetFiles(arg: string, cwd: string): Promise<{ shown: string; path: string }[] | null> {
  const path = isAbsolute(arg) ? arg : resolve(cwd, arg);
  try {
    if (!(await stat(path)).isDirectory()) return [{ shown: arg, path }];
  } catch {
    return null;
  }
  const names = (await readdir(path)).filter((name) => /\.ya?ml$/.test(name)).sort();
  return names.map((name) => ({ shown: join(arg, name), path: join(path, name) }));
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [group, command, ...args] = argv;
  if (group !== 'preset' || command !== 'validate' || args.length === 0) {
    io.err(USAGE);
    return 2;
  }

  const files: { shown: string; path: string }[] = [];
  for (const arg of args) {
    const found = await presetFiles(arg, io.cwd);
    if (!found) {
      io.err(`montagio: ${arg}: no such file or folder`);
      return 2;
    }
    if (found.length === 0) {
      io.err(`montagio: ${arg}: no *.yaml or *.yml file in this folder`);
      return 2;
    }
    files.push(...found);
  }

  let library;
  try {
    // Presets are checked one by one below; the library only brings models, lock and templates.
    library = await loadLibrary(io.root, { presets: false });
  } catch (error) {
    if (!(error instanceof LibraryError)) throw error;
    io.err(`montagio: the repository library at ${io.root} is broken:`);
    for (const problem of error.problems) io.err(`  - ${problem}`);
    return 2;
  }

  let failed = false;
  for (const file of files) {
    const result = validatePreset(await readFile(file.path, 'utf8'), file.shown, library);
    if (result.ok) {
      io.out(`✓ ${file.shown}`);
    } else {
      failed = true;
      io.out(`✗ ${file.shown}`);
      for (const problem of result.problems) io.out(`  - ${problem}`);
    }
  }
  return failed ? 1 : 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  runCli(process.argv.slice(2), {
    // `npm run` changes directory to the repository root; resolve paths against where npm was called.
    cwd: process.env.INIT_CWD ?? process.cwd(),
    root: process.env.MONTAGIO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url)),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`montagio: ${(error as Error).message}`);
      process.exitCode = 2;
    },
  );
}
