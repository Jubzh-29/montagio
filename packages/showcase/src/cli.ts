/**
 * The showcase command line, without side effects: `showcase.ts` is the entry
 * point that runs it.
 *
 *   npm run showcase -- verify [--strict]
 *   npm run showcase -- ingest <smoke results folder> --sample <id> [--pick <preset>=<run> ...]
 *
 * Exit code: 0 when everything is fine, 1 on an error, 2 on a usage error.
 */
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { IngestError, ingestSmoke } from './ingest';
import { verifyShowcase } from './verify';

export type CliIo = { root: string; cwd?: string; out(line: string): void; err(line: string): void };

const USAGE = [
  'Usage:',
  '  showcase verify [--strict]',
  '  showcase ingest <smoke results folder> --sample <id> [--pick <preset>=<run> ...]',
].join('\n');

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'verify') return await verify(rest, io);
    if (command === 'ingest') return await ingest(rest, io);
  } catch (error) {
    if (error instanceof IngestError) {
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
    options: { sample: { type: 'string' }, pick: { type: 'string', multiple: true } },
  });
  if (positionals.length !== 1 || !values.sample) {
    io.err(USAGE);
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
  const result = await ingestSmoke(io.root, folder, values.sample, picks);
  for (const line of result.skipped) io.out(`skipped: ${line}`);
  for (const file of result.added) io.out(`added: ${file}`);
  for (const file of result.replaced) io.out(`replaced: ${file}`);
  io.out(`showcase: ${count(result.added.length + result.replaced.length, 'clip')} ingested for ${values.sample}; run "showcase verify" next`);
  return 0;
}
