import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnv } from './env';
import { linkImportBusy } from './link-import';
import { getServices } from './services';

export type DataPurgeCode = 'data-busy' | 'data-purging' | 'remote-purge-incomplete';

export class DataPurgeError extends Error {
  constructor(readonly code: DataPurgeCode) {
    super(code);
  }
}

type Backend = { kind?: 'demo' | 'local' | 'hosted'; origin?: string; purge(backendJobIds: readonly string[]): Promise<void> };
type Stored = { id: string; state: string; backendJobId?: string; backendKind?: string; backendOrigin?: string; steps?: { backendJobId?: string }[] };

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
const DIRECTORIES = ['uploads', 'generations', 'sequences', 'jobs', 'community', 'characters', 'shares', 'comfy-outputs', 'demo-renders', 'tmp'];
const TEMP_PREFIXES = ['remix-link-', 'remix-sample-'];
const holder = globalThis as typeof globalThis & { __montagioDataPurge?: Promise<void>; __montagioDataWrites?: number };

export function dataWritesActive(): boolean {
  return (holder.__montagioDataWrites ?? 0) > 0;
}

export function assertDataWritable(): void {
  if (holder.__montagioDataPurge) throw new DataPurgeError('data-purging');
}

export async function withDataWrite<T>(work: () => Promise<T>): Promise<T> {
  assertDataWritable();
  holder.__montagioDataWrites = (holder.__montagioDataWrites ?? 0) + 1;
  try {
    return await work();
  } finally {
    holder.__montagioDataWrites = (holder.__montagioDataWrites ?? 1) - 1;
  }
}

async function records(kind: 'generations' | 'sequences' | 'jobs'): Promise<Stored[]> {
  const base = join(getEnv().data, kind);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const read = await Promise.all(
    entries.filter((entry) => entry.isDirectory() && entry.name !== '_keys').map((entry) =>
      readFile(join(base, entry.name, 'record.json'), 'utf8')
        .then((text) => {
          const record = JSON.parse(text) as Stored;
          if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || typeof record.state !== 'string') {
            throw new DataPurgeError('remote-purge-incomplete');
          }
          return record;
        })
        .catch(() => {
          throw new DataPurgeError('remote-purge-incomplete');
        }),
    ),
  );
  return read.filter((record): record is Stored => record !== null);
}

function busyState(text: string): boolean {
  const parsed = JSON.parse(text) as { state?: unknown };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.state !== 'string') return true;
  return !TERMINAL.has(parsed.state);
}

async function sharesActive(): Promise<boolean> {
  const base = join(getEnv().data, 'shares');
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return false;
  }
  const states = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readFile(join(base, entry.name, 'state.json'), 'utf8').then(busyState).catch(() => true)));
  return states.some(Boolean);
}

async function captionExportsActive(): Promise<boolean> {
  const base = join(getEnv().data, 'jobs');
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return false;
  }
  const states = await Promise.all(
    names.map(async (name) => {
      const exports = await readdir(join(base, name, 'exports')).catch(() => [] as string[]);
      return Promise.all(exports.map((id) => readFile(join(base, name, 'exports', id, 'state.json'), 'utf8').then(busyState).catch(() => true)));
    }),
  );
  return states.flat().some(Boolean);
}

async function removeLocalData(): Promise<void> {
  const { data } = getEnv();
  await Promise.all(DIRECTORIES.map((name) => rm(join(data, name), { recursive: true, force: true })));
  const names = await readdir(data).catch(() => [] as string[]);
  await Promise.all(names.filter((name) => TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))).map((name) => rm(join(data, name), { recursive: true, force: true })));
}

function assertRemoteCoverage(records: readonly Stored[], backend: Backend): void {
  for (const record of records) {
    if (record.backendKind === 'demo') continue;
    if (record.backendKind !== 'local' || !record.backendOrigin || backend.kind !== 'local' || backend.origin !== record.backendOrigin) {
      throw new DataPurgeError('remote-purge-incomplete');
    }
  }
}

async function purgeOnce(backend: Backend): Promise<void> {
  if (dataWritesActive()) throw new DataPurgeError('data-busy');
  const [generations, sequences, jobRecords] = await Promise.all([records('generations'), records('sequences'), records('jobs')]);
  if ([...generations, ...sequences, ...jobRecords].some((record) => !TERMINAL.has(record.state)) || (await sharesActive()) || (await captionExportsActive()) || linkImportBusy() || dataWritesActive()) {
    throw new DataPurgeError('data-busy');
  }
  assertRemoteCoverage([...generations, ...jobRecords], backend);
  const backendJobIds = [
    ...generations.flatMap((record) => (record.backendJobId ? [record.backendJobId] : [])),
    ...jobRecords.flatMap((record) => record.steps?.flatMap((step) => (step.backendJobId ? [step.backendJobId] : [])) ?? []),
  ];
  try {
    await backend.purge(backendJobIds);
  } catch {
    throw new DataPurgeError('remote-purge-incomplete');
  }
  await removeLocalData();
}

export async function purgeStudioData(opts: { backend?: Backend } = {}): Promise<void> {
  if (holder.__montagioDataPurge) throw new DataPurgeError('data-purging');
  const backend = opts.backend ?? getServices().backend;
  const pending = purgeOnce(backend);
  holder.__montagioDataPurge = pending;
  try {
    await pending;
  } finally {
    delete holder.__montagioDataPurge;
  }
}
