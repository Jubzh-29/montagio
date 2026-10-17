/**
 * Entry point of the Montagio command line. It always runs: an "am I the main
 * module?" guard compares a realpath'd import.meta.url with argv[1] as given,
 * and silently skips everything when the repository is reached through a
 * junction or a symlink.
 *
 *   npm run montagio -- preset validate presets/my-move.yaml
 *   npm run montagio -- preset validate presets          # every *.yaml / *.yml in a folder
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
    console.error(`montagio: ${(error as Error).message}`);
    process.exitCode = 2;
  },
);
