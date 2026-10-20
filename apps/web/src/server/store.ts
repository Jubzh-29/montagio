import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  /** Rendered from a preset edited in the remix editor (its text is in preset.yaml). */
  remix?: true;
  /** The delivered clip's frame count, read by probe (HD takes 121 at most); absent for a clip delivered before. */
  frames?: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const generationsDir = () => join(getEnv().data, 'generations');
const keyFile = (key: string) =>
  join(generationsDir(), '_keys', `${createHash('sha256').update(key).digest('hex')}.json`);

/** Write to a temporary file, then rename: readers never see a half-written record. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, content);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      // Windows can briefly refuse the replace while another request reads the file.
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

export async function saveRecord(record: GenerationRecord): Promise<void> {
  const dir = join(generationsDir(), record.id);
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, 'record.json'), JSON.stringify(record, null, 2));
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

/** The remixed preset exactly as the user sent it, next to the workflow it compiled to. */
export async function savePresetText(id: string, text: string): Promise<void> {
  const dir = join(generationsDir(), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'preset.yaml'), text);
}

/** The text savePresetText kept, or null: a library generation has none of its own. */
export async function readPresetText(id: string): Promise<string | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return await readFile(join(generationsDir(), id, 'preset.yaml'), 'utf8');
  } catch {
    return null;
  }
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
