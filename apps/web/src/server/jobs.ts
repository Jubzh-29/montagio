import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IDEMPOTENCY_WINDOW_MS,
  isBackendError,
  type JobState,
  type OutputKind,
  type SubmitJob,
} from '@montagio/comfy-adapter';
import { CompileError, type ApiWorkflow, type Aspect, type Library } from '@montagio/presets';
import type { ExtensionId } from '@montagio/registry';
import { ensureTools, probe, tagAudio, tagClip, tagImage } from '@montagio/sequence';
import type { JobSummary } from '@/lib/api-types';
import { getEnv } from './env';
import { JobError } from './errors';
import { markRejected } from './extensions';
import { failureResponse, mediaUrlFor } from './generations';
import { withLock } from './lock';
import { getServices } from './services';
import { writeAtomic } from './store';
import { TASKS } from './tasks';
import { saveUploadFromFile, type Provenance } from './uploads';

export { JobError } from './errors';

export type JobTask = 't2i' | 'edit' | 'effect' | 'hook' | 'avatar' | 'music' | 'upscale' | 'image-upscale' | 'motion' | 'restyle' | 'ad' | 'voice-change';

export type StepRecord = {
  name: string;
  extension: ExtensionId | null;
  backendJobId?: string;
  /** Known once the step is compiled; a pending step says "video" until then. */
  output: OutputKind;
  outputNode: string;
  state: 'pending' | JobState;
  progress: number;
  /** The backend's file, for the next step to read. */
  outputPath?: string;
  /** An intermediate image, tagged and shown while the next step renders (a hook's end frame). */
  outputUrl?: string;
  error?: string;
};

/** The effect, the hook or the model of a job; the client writes the words. */
export type JobLabel = { itemId?: string; name?: string };

export type JobRecord = {
  id: string;
  task: JobTask;
  inputs: Record<string, unknown>;
  label: JobLabel;
  modelId: string;
  seed: number;
  aspect?: Aspect;
  parent?: { source: 'generation' | 'sequence' | 'job'; id: string };
  steps: StepRecord[];
  current: number;
  state: JobState;
  progress: number;
  outputUrl?: string;
  /** An image output, registered as an upload: usable as a start photo. */
  outputImageRef?: string;
  personal?: boolean;
  /** A video output's frame count (the HD step takes 121 at most). */
  frames?: number;
  /** A film's 9:16 cut, when the task makes one (music under a film). */
  verticalUrl?: string;
  error?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type CompiledStep = {
  workflow: ApiWorkflow;
  output: { kind: OutputKind; node: string };
  files: NonNullable<SubmitJob['files']>;
};

export type StepPlan = {
  name: string;
  /** What the demo backend renders and the logs name: the effect, the hook, "text-to-image". */
  presetId: string;
  extension: ExtensionId | null;
  compile: (record: JobRecord) => Promise<CompiledStep>;
};

export type Prepared = {
  inputs: Record<string, unknown>;
  label: JobLabel;
  modelId: string;
  seed: number;
  aspect?: Aspect;
  parent?: JobRecord['parent'];
};

export type TaskDef = {
  /** Validate the request body (throws JobError), with the library already loaded. */
  prepare(body: Record<string, unknown>, lib: Library): Promise<Prepared>;
  /** Plan the steps from the persisted record: the same answer after a restart. */
  steps(record: JobRecord, lib: Library): StepPlan[];
  /** Provenance given to an image output registered as an upload. */
  imageOrigin?(record: JobRecord): Promise<Provenance>;
  /**
   * The task's own delivery of its last output (music: mixed under its film, then cut to 9:16),
   * in place of the delivery by output kind. A failure ends the job in deliver-failed.
   */
  deliver?(record: JobRecord, outputPath: string, dir: string): Promise<{ outputUrl: string; verticalUrl?: string; frames?: number }>;
};

export type JobEngine = {
  create(task: JobTask, body: Record<string, unknown>, idempotencyKey: string): Promise<{ record: JobRecord; created: boolean }>;
  /** Moves the job forward by one step at most (poll-driven). */
  get(id: string): Promise<JobRecord | null>;
  cancel(id: string): Promise<JobRecord | null>;
  /** The record as stored, without asking the backend. */
  read(id: string): Promise<JobRecord | null>;
  list(): Promise<JobRecord[]>;
};

const TERMINAL = new Set<JobState>(['succeeded', 'failed', 'canceled']);
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
/** Never written to a record whose provenance is unknown: the cautious reading is an imported photo. */
const UNKNOWN_PROVENANCE: Provenance = { origin: 'upload', personal: true };

const jobsDir = () => join(getEnv().data, 'jobs');
const jobDir = (id: string) => join(jobsDir(), id);
const keyFile = (key: string) => join(jobsDir(), '_keys', `${createHash('sha256').update(key).digest('hex')}.json`);
const stepWorkflowFile = (id: string, index: number) => join(jobDir(id), `step${index}.workflow.json`);

async function saveJob(record: JobRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await mkdir(jobDir(record.id), { recursive: true });
  await writeAtomic(join(jobDir(record.id), 'record.json'), JSON.stringify(record, null, 2));
}

async function readJob(id: string): Promise<JobRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(jobDir(id), 'record.json'), 'utf8')) as JobRecord;
  } catch {
    return null;
  }
}

/** The workflow of the last step submitted, for "Open in ComfyUI". */
export async function readJobWorkflow(id: string): Promise<{ record: JobRecord; workflow: ApiWorkflow } | null> {
  const record = await readJob(id);
  if (!record) return null;
  for (let index = record.steps.length - 1; index >= 0; index--) {
    try {
      return { record, workflow: JSON.parse(await readFile(stepWorkflowFile(id, index), 'utf8')) as ApiWorkflow };
    } catch {
      // this step was not submitted yet
    }
  }
  return null;
}

/** A compile error is the request's fault: a stable code for the client, the details in the log. */
function compileFailure(error: unknown, task: string): never {
  if (error instanceof CompileError) {
    console.error(`[montagio] ${task}: the job cannot compile: ${error.message}`);
    throw new JobError('invalid-input');
  }
  throw error;
}

// Creations in flight by idempotency key, shared by every route bundle of this process.
const holder = globalThis as typeof globalThis & { __montagioJobCreations?: Map<string, Promise<{ record: JobRecord; created: boolean }>> };
const creations: Map<string, Promise<{ record: JobRecord; created: boolean }>> = (holder.__montagioJobCreations ??= new Map());

export function createJobEngine(tasks: Partial<Record<JobTask, TaskDef>>): JobEngine {
  const taskOf = (task: JobTask): TaskDef => {
    const def = tasks[task];
    if (!def) throw new Error(`no job task "${task}"`);
    return def;
  };

  /** Compile step `index` and hand it to the backend; a refused workflow hides its extension. */
  async function submitStep(record: JobRecord, index: number, lib: Library): Promise<void> {
    const plan = taskOf(record.task).steps(record, lib)[index]!;
    const compiled = await plan.compile(record).catch((error: unknown) => compileFailure(error, record.task));
    const step = record.steps[index]!;
    step.output = compiled.output.kind;
    step.outputNode = compiled.output.node;
    await mkdir(jobDir(record.id), { recursive: true });
    await writeFile(stepWorkflowFile(record.id, index), JSON.stringify(compiled.workflow, null, 2));
    try {
      const { backendJobId } = await getServices().backend.submit({
        workflow: compiled.workflow,
        presetId: plan.presetId,
        idempotencyKey: `${record.idempotencyKey}#step${index}`,
        files: compiled.files,
        output: compiled.output.kind,
        outputNode: compiled.output.node,
      });
      step.backendJobId = backendJobId;
      step.state = 'queued';
      record.current = index;
    } catch (error) {
      if (isBackendError(error) && error.code === 'workflow-rejected' && plan.extension) {
        markRejected(plan.extension, `ComfyUI refused the ${plan.name} workflow (${error.message})`);
      }
      throw error;
    }
  }

  /** Copy the last step's output with the AI-generated mention, where the client can fetch it; false when the task's own delivery failed. */
  async function deliver(record: JobRecord, step: StepRecord, outputPath: string): Promise<boolean> {
    const dir = jobDir(record.id);
    const own = taskOf(record.task).deliver;
    if (own) {
      try {
        Object.assign(record, await own(record, outputPath, dir));
        return true;
      } catch (error) {
        console.error(`[montagio] job ${record.id}: the ${record.task} delivery failed`, error);
        return false;
      }
    }
    try {
      if (step.output === 'video') {
        const out = join(dir, 'output.mp4');
        await access(out).catch(() => tagClip(outputPath, out));
        const info = await probe(out);
        record.frames = Math.round(info.duration_s * info.fps);
        record.outputUrl = mediaUrlFor(out);
      } else if (step.output === 'image') {
        const out = join(dir, 'output.png');
        await access(out).catch(() => tagImage(outputPath, out));
        const provenance = (await taskOf(record.task).imageOrigin?.(record)) ?? UNKNOWN_PROVENANCE;
        const upload = await saveUploadFromFile(out, provenance);
        record.outputImageRef = upload.imageRef;
        record.personal = provenance.personal;
        record.outputUrl = mediaUrlFor(join(getEnv().data, ...upload.imageRef.split('/')));
      } else {
        const out = join(dir, 'output.flac');
        await access(out).catch(() => tagAudio(outputPath, out));
        record.outputUrl = mediaUrlFor(out);
      }
    } catch (error) {
      // The render is not lost: the raw output goes out untagged, and the log says why.
      console.error(`[montagio] job ${record.id}: the AI-generated mention could not be written, output delivered untagged`, error);
      record.outputUrl = mediaUrlFor(outputPath);
    }
    return true;
  }

  async function createOnce(task: JobTask, body: Record<string, unknown>, idempotencyKey: string) {
    try {
      const previous = JSON.parse(await readFile(keyFile(idempotencyKey), 'utf8')) as { id: string; createdAt: string };
      if (Date.now() - Date.parse(previous.createdAt) < IDEMPOTENCY_WINDOW_MS) {
        const record = await readJob(previous.id);
        if (record) return { record, created: false };
      }
    } catch {
      // no job for this key yet
    }
    const def = taskOf(task);
    const lib = await getServices().library;
    const prepared = await def.prepare(body, lib).catch((error: unknown) => compileFailure(error, task));
    try {
      await ensureTools();
    } catch (error) {
      console.error('[montagio] FFmpeg is required before a job:', error instanceof Error ? error.message : error);
      throw new JobError('ffmpeg-missing');
    }
    const now = new Date(Date.now()).toISOString();
    const record: JobRecord = {
      id: randomUUID(),
      task,
      ...prepared,
      steps: [],
      current: 0,
      state: 'queued',
      progress: 0,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    record.steps = def.steps(record, lib).map((plan) => ({
      name: plan.name,
      extension: plan.extension,
      output: 'video' as const,
      outputNode: '',
      state: 'pending' as const,
      progress: 0,
    }));
    await submitStep(record, 0, lib);
    await saveJob(record);
    await mkdir(join(jobsDir(), '_keys'), { recursive: true });
    await writeFile(keyFile(idempotencyKey), JSON.stringify({ id: record.id, createdAt: now }));
    return { record, created: true };
  }

  async function finish(record: JobRecord, state: 'failed' | 'canceled', error?: string): Promise<JobRecord> {
    record.state = state;
    if (error) record.error = error;
    await saveJob(record);
    return record;
  }

  return {
    create(task, body, idempotencyKey) {
      const pending = creations.get(idempotencyKey);
      if (pending) return pending.then(({ record }) => ({ record, created: false }));
      const creation = createOnce(task, body, idempotencyKey).finally(() => creations.delete(idempotencyKey));
      creations.set(idempotencyKey, creation);
      return creation;
    },

    get(id) {
      return withLock(id, async () => {
        const record = await readJob(id);
        if (!record || TERMINAL.has(record.state)) return record;
        const index = record.current;
        const step = record.steps[index]!;
        if (!step.backendJobId) return finish(record, 'failed', 'lost');
        let job;
        try {
          job = await getServices().backend.get(step.backendJobId, { output: step.output, outputNode: step.outputNode });
        } catch (error) {
          // The proxy or the pod is out of reach for now: keep polling a paid render.
          if (!isBackendError(error) || !error.retryable) throw error;
          console.warn(`[montagio] job ${id}: backend out of reach, still waiting (${error.message})`);
          return record;
        }
        step.state = job.state;
        step.progress = job.progress;
        record.state = job.state === 'queued' && index > 0 ? 'running' : job.state;
        record.progress = (index + job.progress) / record.steps.length;
        if (job.state === 'failed') {
          step.error = job.error ?? 'failed';
          return finish(record, 'failed', step.error);
        }
        if (job.state === 'canceled') return finish(record, 'canceled');
        if (job.state !== 'succeeded') {
          await saveJob(record);
          return record;
        }
        if (!job.outputPath) return finish(record, 'failed', 'no-output');
        step.outputPath = job.outputPath;

        if (index < record.steps.length - 1) {
          if (step.output === 'image') {
            const shown = join(jobDir(id), `step${index}.png`);
            await access(shown)
              .catch(() => tagImage(job.outputPath!, shown))
              .then(() => (step.outputUrl = mediaUrlFor(shown)))
              .catch((error: unknown) => console.error(`[montagio] job ${id}: step ${index} image not tagged`, error));
          }
          record.state = 'running';
          try {
            await submitStep(record, index + 1, await getServices().library);
          } catch (error) {
            if (isBackendError(error) && error.retryable) {
              console.warn(`[montagio] job ${id}: backend out of reach while starting step ${index + 1}, still waiting`);
              await saveJob(record);
              return record;
            }
            if (error instanceof JobError) return finish(record, 'failed', error.code);
            if (isBackendError(error)) return finish(record, 'failed', error.code);
            throw error;
          }
          await saveJob(record);
          return record;
        }

        if (!(await deliver(record, step, job.outputPath))) return finish(record, 'failed', 'deliver-failed');
        record.state = 'succeeded';
        record.progress = 1;
        await saveJob(record);
        return record;
      });
    },

    cancel(id) {
      return withLock(id, async () => {
        const record = await readJob(id);
        if (!record || TERMINAL.has(record.state)) return record;
        const backendJobId = record.steps[record.current]?.backendJobId;
        if (backendJobId) await getServices().backend.cancel(backendJobId);
        return finish(record, 'canceled');
      });
    },

    read: readJob,

    async list() {
      let names: string[];
      try {
        names = await readdir(jobsDir());
      } catch {
        return [];
      }
      const records = await Promise.all(names.filter((name) => name !== '_keys').map(readJob));
      return records.filter((record): record is JobRecord => record !== null);
    },
  };
}

/** The engine of the app, on its task table. */
export const jobs = createJobEngine(TASKS);

const STATUS: Record<JobError['code'], number> = {
  'extension-disabled': 404,
  'invalid-input': 400,
  'consent-required': 400,
  'blocked-name': 400,
  'unknown-image': 400,
  'ffmpeg-missing': 503,
  'speech-too-long': 400,
  'speech-too-short': 400,
  'rights-required': 400,
};

/** The HTTP answer for a known failure of a job route, or null for an unexpected error. */
export function jobFailureResponse(error: unknown): Response | null {
  if (error instanceof JobError) return Response.json({ error: error.code }, { status: STATUS[error.code] });
  return failureResponse(error);
}

/** What the client sees of a job: no paths, no backend ids. */
export function jobSummary(record: JobRecord): JobSummary {
  const stepImage = [...record.steps].reverse().find((step) => step.outputUrl);
  return {
    id: record.id,
    task: record.task,
    state: record.state,
    progress: record.progress,
    ...(record.outputUrl ? { outputUrl: record.outputUrl } : {}),
    ...(record.outputImageRef ? { outputImageRef: record.outputImageRef } : {}),
    ...(record.personal !== undefined ? { personal: record.personal } : {}),
    ...(stepImage?.outputUrl ? { stepImageUrl: stepImage.outputUrl } : {}),
    label: record.label,
    modelId: record.modelId,
    ...(record.error ? { error: record.error } : {}),
    ...(record.frames !== undefined ? { frames: record.frames } : {}),
    ...(record.verticalUrl ? { verticalUrl: record.verticalUrl } : {}),
    createdAt: record.createdAt,
  };
}
