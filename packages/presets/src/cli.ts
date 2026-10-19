/**
 * Montagio command line (spec §4.3), without side effects: `montagio.ts` is the
 * entry point that runs it.
 *
 * Exit code: 0 when every file is valid, 1 when one is not, 2 on a usage error.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { LibraryError, loadLibrary } from './library';
import { validatePresetFile } from './validate';

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

/**
 * The text of a preset file, decoded as strict UTF-8 like the ComfyUI node pack
 * does: a lenient read would turn a Windows-1252 "é" into U+FFFD and pass a file
 * that ComfyUI refuses. A UTF-8 byte order mark is dropped.
 */
async function readPresetText(path: string): Promise<{ text: string } | { problem: string }> {
  const bytes = await readFile(path);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return { problem: 'file is UTF-16 text: save it as UTF-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { problem: 'file is not UTF-8 text: save it as UTF-8' };
  }
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
    // The same file named twice (or a file inside a folder also given) is validated once.
    for (const file of found) if (!files.some((known) => known.path === file.path)) files.push(file);
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
  // loadLibrary refuses a folder where two files share a preset id: so does the check. Camera
  // presets, effects and hooks live in their own folders, so an id is unique per capability.
  const ids = new Map<string, string>();
  for (const file of files) {
    const read = await readPresetText(file.path);
    const result = 'text' in read ? validatePresetFile(read.text, file.shown, library) : { ok: false as const, problems: [read.problem] };
    const problems = result.ok ? [] : result.problems;
    if (result.ok) {
      const key = `${result.preset.capability}:${result.preset.id}`;
      const other = ids.get(key);
      if (other) problems.push(`id: duplicate preset id "${result.preset.id}" (also in ${other})`);
      else ids.set(key, file.shown);
    }
    if (problems.length === 0) {
      io.out(`✓ ${file.shown}`);
    } else {
      failed = true;
      io.out(`✗ ${file.shown}`);
      for (const problem of problems) io.out(`  - ${problem}`);
    }
  }
  return failed ? 1 : 0;
}
