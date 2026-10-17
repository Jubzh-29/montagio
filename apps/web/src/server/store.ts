import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobState } from '@montagio/comfy-adapter';
import type { ApiWorkflow, Aspect } from '@montagio/presets';
import { getEnv } from './env';

export type GenerationRecord = {
  id: string;
  presetId: string;
  modelId: string;
  imageRef: string;
  userPrompt?: string;
  seed: number;
  aspect: Aspect;
  state: JobState;
  progress: number;
  backendKind: string;
  backendJobId: string;
  outputUrl?: string;
  error?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const generationsDir = () => join(getEnv().data, 'generations');
const keyFile = (key: string) =>
  join(generationsDir(), '_keys', `${createHash('sha256').update(key).digest('hex')}.json`);

export async function saveRecord(record: GenerationRecord): Promise<void> {
  const dir = join(generationsDir(), record.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'record.json'), JSON.stringify(record, null, 2));
}

export async function readRecord(id: string): Promise<GenerationRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(generationsDir(), id, 'record.json'), 'utf8')) as GenerationRecord;
  } catch {
    return null;
  }
}

export async function saveWorkflow(id: string, workflow: ApiWorkflow): Promise<void> {
  const dir = join(generationsDir(), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'workflow.api.json'), JSON.stringify(workflow, null, 2));
}

export async function readWorkflow(id: string): Promise<ApiWorkflow | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(generationsDir(), id, 'workflow.api.json'), 'utf8')) as ApiWorkflow;
  } catch {
    return null;
  }
}

export async function rememberKey(key: string, id: string, createdAt: string): Promise<void> {
  await mkdir(join(generationsDir(), '_keys'), { recursive: true });
  await writeFile(keyFile(key), JSON.stringify({ id, createdAt }));
}

export async function lookupKey(key: string): Promise<{ id: string; createdAt: string } | null> {
  try {
    return JSON.parse(await readFile(keyFile(key), 'utf8')) as { id: string; createdAt: string };
  } catch {
    return null;
  }
}
