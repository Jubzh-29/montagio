// npm run reproduce -- <recipe> --photo <file>: a recipe rendered again on this Montagio, from a terminal.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MontagioClient, type ClientDeps } from './client';
import { readConfig } from './config';
import { toFailure } from './errors';
import { loadRecipe, reproduce, withPhoto } from './reproduce';

const USAGE = [
  'Render a Montagio recipe again on this Montagio and its local ComfyUI, with the same seed.',
  '',
  '  npm run reproduce -- <recipe.json | clip.mp4 | image.png> --photo <file> [--input field=file]... [--consent] [--rights] [--voice-consent] [--face-consent] [--out folder]',
  '',
  'The recipe never holds the photo: give yours. Montagio must be running (./montagio.sh start, or montagio.ps1 start on Windows)',
  'at MONTAGIO_URL (default http://127.0.0.1:3000); --out (or MONTAGIO_MCP_OUT) saves the file there.',
].join('\n');

const yesNo = (value: boolean | null) => (value === null ? 'unknown' : value ? 'yes' : 'no');

export type CliIo = {
  env?: Record<string, string | undefined>;
  deps?: ClientDeps;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

/** The command's work, its exit code returned: 0 when the render is done, 1 otherwise. */
export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        photo: { type: 'string' },
        input: { type: 'string', multiple: true },
        consent: { type: 'boolean', default: false },
        rights: { type: 'boolean', default: false },
        'voice-consent': { type: 'boolean', default: false },
        'face-consent': { type: 'boolean', default: false },
        out: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    (values.help ? out : err)(USAGE);
    return values.help ? 0 : 1;
  }
  try {
    const env = { ...(io.env ?? process.env), ...(values.out ? { MONTAGIO_MCP_OUT: values.out } : {}) };
    const client = new MontagioClient(readConfig(env), io.deps);
    const recipe = await loadRecipe(positionals[0]!);
    const inputs: Record<string, string> = {};
    for (const pair of values.input ?? []) {
      const eq = pair.indexOf('=');
      if (eq <= 0) throw new Error(`--input takes field=file, not "${pair}"`);
      inputs[pair.slice(0, eq)] = resolve(pair.slice(eq + 1));
    }
    const result = await reproduce(
      client,
      {
        recipe,
        inputs: values.photo ? withPhoto(recipe, inputs, resolve(values.photo)) : inputs,
        consent: values.consent,
        rights: values.rights,
        voiceConsent: values['voice-consent'],
        faceConsent: values['face-consent'],
      },
      { onProgress: (status) => err(`${status.task} ${status.id}: ${status.state} ${Math.round(status.progress * 100)}%`) },
    );
    let file: string | undefined;
    if (client.config.outDir && result.render.outputUrl) file = await client.download(result.render);
    out(file ?? result.render.outputUrl ?? result.render.id);
    out(`same workflow: ${yesNo(result.sameWorkflow)}`);
    for (const [field, same] of Object.entries(result.sameInputs)) out(`same ${field}: ${yesNo(same)}`);
    out(`Montagio: recipe ${result.stack.recipe?.slice(0, 7) ?? 'unknown'} · here ${result.stack.here?.slice(0, 7) ?? 'unknown'}`);
    out(result.note);
    return 0;
  } catch (error) {
    const failure = toFailure(error);
    err(`${failure.code}: ${failure.message}${Object.keys(failure.details).length ? ` ${JSON.stringify(failure.details)}` : ''}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runCli(process.argv.slice(2));
