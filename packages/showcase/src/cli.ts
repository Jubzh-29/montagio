/**
 * The showcase command line, without side effects: `showcase.ts` is the entry
 * point that runs it.
 *
 *   npm run showcase -- verify [--strict]
 *   npm run showcase -- ingest <smoke results folder> --sample <id> [--pick <preset>=<run> ...]
 *   npm run showcase -- ingest --examples <smoke results folder> --sample <id>
 *   npm run showcase -- prepare [--strict] [--out <dir>] [--repo-url <url>]
 *
 * Exit code: 0 when everything is fine, 1 on an error, 2 on a usage error.
 */
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { IngestError, ingestExamples, ingestSmoke } from './ingest';
import { PrepareError, prepareShowcase } from './prepare';
import { verifyShowcase } from './verify';

export type CliIo = { root: string; cwd?: string; out(line: string): void; err(line: string): void };

const USAGE = [
  'Usage:',
  '  showcase verify [--strict]',
  '  showcase ingest <smoke results folder> --sample <id> [--pick <preset>=<run> ...]',
  '  showcase ingest --examples <smoke results folder> --sample <id>   (one smoke folder per call)',
  '  showcase prepare [--strict] [--out <dir>] [--repo-url <url>]',
].join('\n');

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'verify') return await verify(rest, io);
    if (command === 'ingest') return await ingest(rest, io);
    if (command === 'prepare') return await prepare(rest, io);
  } catch (error) {
    if (error instanceof IngestError || error instanceof PrepareError) {
      for (const problem of error.problems) io.err(`error: ${problem}`);
      return 1;
    }
    if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.err(`${(error as Error).message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  io.err(USAGE);
  return 2;
}

async function verify(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { strict: { type: 'boolean', default: false } } });
  const report = await verifyShowcase(io.root, { strict: values.strict });
  for (const line of report.errors) io.err(`error: ${line}`);
  for (const line of report.warnings) io.out(`warning: ${line}`);
  io.out(
    `showcase: ${report.rendered} rendered, ${count(report.placeholders, 'placeholder')}, ` +
      `${count(report.errors.length, 'error')}, ${count(report.warnings.length, 'warning')}${values.strict ? ' (strict)' : ''}`,
  );
  return report.errors.length > 0 ? 1 : 0;
}

async function ingest(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { sample: { type: 'string' }, pick: { type: 'string', multiple: true }, examples: { type: 'boolean', default: false } },
  });
  if (positionals.length !== 1 || !values.sample) {
    io.err(USAGE);
    return 2;
  }
  // smoke.ts numbers every extension record run 1: two tries of an example live in two folders,
  // and the one to keep is the folder ingested, so --pick has nothing to choose among.
  if (values.examples && (values.pick ?? []).length > 0) {
    io.err('--pick does not apply to --examples: use one --out folder per smoke call, and ingest the folder of the try to keep');
    return 2;
  }
  const picks: Record<string, number> = {};
  for (const pick of values.pick ?? []) {
    const match = /^([a-z0-9-]+)=(\d+)$/.exec(pick);
    if (!match) {
      io.err(`--pick ${pick}: expected <preset>=<run>, e.g. --pick crash-push=2`);
      return 2;
    }
    picks[match[1]!] = Number(match[2]);
  }
  const folder = isAbsolute(positionals[0]!) ? positionals[0]! : resolve(io.cwd ?? process.cwd(), positionals[0]!);
  const result = await (values.examples ? ingestExamples : ingestSmoke)(io.root, folder, values.sample, picks);
  for (const line of result.skipped) io.out(`skipped: ${line}`);
  for (const file of result.added) io.out(`added: ${file}`);
  for (const file of result.replaced) io.out(`replaced: ${file}`);
  io.out(
    `showcase: ${count(result.added.length + result.replaced.length, values.examples ? 'example' : 'clip')} ingested for ${values.sample}; run "showcase verify" next`,
  );
  return 0;
}

async function prepare(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { strict: { type: 'boolean', default: false }, out: { type: 'string' }, 'repo-url': { type: 'string' } },
  });
  const outDir = values.out ? (isAbsolute(values.out) ? values.out : resolve(io.cwd ?? process.cwd(), values.out)) : undefined;
  const started = Date.now();
  const data = await prepareShowcase(io.root, { outDir, strict: values.strict, repoUrl: values['repo-url'] || null });
  const placeholders = data.clips.filter((clip) => clip.placeholder).length;
  io.out(
    `showcase: ${count(data.clips.length, 'clip')} (${data.clips.length - placeholders} rendered, ${count(placeholders, 'placeholder')}), ` +
      `${count(data.samples.length, 'sample')}, prepared in ${Math.round((Date.now() - started) / 1000)} s`,
  );
  if (!data.repoUrl) io.out('showcase: no --repo-url: the page shows "source link added at release"');
  return 0;
}
