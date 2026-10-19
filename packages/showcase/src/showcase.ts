/**
 * Entry point of the showcase command line (see cli.ts). Like the presets CLI,
 * it always runs instead of guessing whether it is the main module.
 *
 *   npm run showcase -- verify --strict
 */
import { fileURLToPath } from 'node:url';
import { runCli } from './cli';

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
    console.error(`showcase: ${(error as Error).message}`);
    process.exitCode = 2;
  },
);
