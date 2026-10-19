import { access, mkdir, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  Comfy,
  InvalidWorkflow,
  MissingAsset,
  NotFound,
  WorkflowFormatUi,
  type Job,
  type Output,
  type WorkflowGraph,
} from '@comfyorg/sdk';
import {
  IDEMPOTENCY_WINDOW_MS,
  OUTPUT_KINDS,
  type BackendJob,
  type GenerationBackend,
  type OutputKind,
  type OutputWanted,
  type SubmitJob,
} from './backend';
import { BackendError } from './errors';
import { assertLocalBaseUrl, guardFetch } from './target';

/** Ids the proxy hands back become file names and URL segments: nothing else gets through. */
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i;
/** The extensions an output keeps, by kind; any other becomes ".bin". */
const EXTENSIONS: Record<OutputKind, Set<string>> = {
  video: new Set(['.mp4', '.webm', '.mov', '.mkv', '.gif']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  audio: new Set(['.flac', '.mp3', '.wav', '.opus', '.ogg', '.m4a']),
};
/**
 * A clip is a few megabytes: a download still running after this is stuck (a tunnel
 * gone silent). The SDK sets no deadline of its own on a download.
 */
const CLIP_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

const isJobId = (id: string) => JOB_ID.test(id) && id !== '..';
const lost = (id: string): BackendJob => ({ id, state: 'failed', progress: 0, error: 'lost' });

/**
 * Build the SDK client against `base` only. `@comfyorg/sdk` reads COMFY_BASE_URL and
 * COMFY_API_KEY at construction: the base URL is set and the key removed for that
 * moment (a cloud key is never sent to a self-hosted proxy), then both are restored.
 */
function buildClient(base: string, build: () => Comfy): Comfy {
  const previous = { COMFY_BASE_URL: process.env.COMFY_BASE_URL, COMFY_API_KEY: process.env.COMFY_API_KEY };
  process.env.COMFY_BASE_URL = base;
  delete process.env.COMFY_API_KEY;
  try {
    return build();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The result of a finished job: an output of `kind`, from `node` first when it is given.
 * comfy-api-proxy types an output by ComfyUI's UI key: audio and images keep their kind
 * (a FLAC can come back as application/octet-stream, so the type wins over the content
 * type), but SaveVideo files its MP4 under "images". A typed output whose content type
 * names another kind is skipped, and the content type is the fallback: that is how a
 * video is found.
 */
function pickOutput(outputs: Output[], kind: OutputKind, node?: string): Output | undefined {
  const otherKind = (o: Output) => OUTPUT_KINDS.some((k) => k !== kind && o.contentType.startsWith(`${k}/`));
  const among = (list: Output[]) =>
    list.find((o) => o.type === kind && !otherKind(o)) ?? list.find((o) => o.contentType.startsWith(`${kind}/`));
  return (node ? among(outputs.filter((o) => o.nodeId === node)) : undefined) ?? among(outputs);
}

/**
 * Backend "local": the open-weights workflows run on a ComfyUI reached through
 * comfy-api-proxy, with @comfyorg/sdk. It keeps no job state of its own: `get`
 * reads the job back from the proxy by id, so a restarted app finds a render that
 * kept going on the pod.
 */
export class ComfyBackend implements GenerationBackend {
  readonly kind = 'local' as const;
  private readonly client: Comfy;
  /** Submits by idempotency key, kept for the idempotency window and no longer. */
  private readonly submissions = new Map<string, { at: number; pending: Promise<{ backendJobId: string }> }>();
  /** Downloads in flight, by job id: once a clip is on disk, the file is the record. */
  private readonly downloads = new Map<string, Promise<string>>();
  /** The output each job submitted here delivers; a restarted app passes it to `get` instead. */
  private readonly wanted = new Map<string, OutputWanted>();

  constructor(
    private readonly opts: {
      baseUrl: string;
      outputsDir: string;
      fetch?: typeof fetch;
      downloadTimeoutMs?: number;
      now?: () => number;
    },
  ) {
    const target = assertLocalBaseUrl(opts.baseUrl);
    this.client = buildClient(target.base, () => new Comfy({ fetch: guardFetch(target.url, opts.fetch), clientInfo: 'montagio/0.1' }));
  }

  submit(job: SubmitJob): Promise<{ backendJobId: string }> {
    const now = this.opts.now?.() ?? Date.now();
    // Past the window the web layer treats a reused key as a new request: so does the backend.
    for (const [key, entry] of this.submissions) {
      if (now - entry.at >= IDEMPOTENCY_WINDOW_MS) this.submissions.delete(key);
    }
    const known = this.submissions.get(job.idempotencyKey);
    if (known) return known.pending;
    const entry = { at: now, pending: this.submitOnce(job) };
    this.submissions.set(job.idempotencyKey, entry);
    // A failed submit is not remembered: the same key may try again.
    entry.pending.catch(() => {
      if (this.submissions.get(job.idempotencyKey) === entry) this.submissions.delete(job.idempotencyKey);
    });
    return entry.pending;
  }

  private async submitOnce(job: SubmitJob): Promise<{ backendJobId: string }> {
    const workflow = this.client.workflows.fromJson(structuredClone(job.workflow) as WorkflowGraph);
    for (const file of job.files ?? []) workflow.setInput(file.node, file.field, this.client.assets.fromFile(file.path));
    let submitted: Job;
    try {
      submitted = await this.client.submit(workflow);
    } catch (error) {
      if (error instanceof InvalidWorkflow || error instanceof MissingAsset || error instanceof WorkflowFormatUi) {
        console.error(`[montagio] ComfyUI rejected the workflow of preset ${job.presetId}: ${error.message}`, error.details ?? '');
        throw new BackendError('workflow-rejected', false, error.message);
      }
      throw new BackendError('backend-unavailable', true, describe(error));
    }
    if (!isJobId(submitted.id)) {
      throw new BackendError('backend-error', false, `the proxy returned an unusable job id ${JSON.stringify(submitted.id)}`);
    }
    this.wanted.set(submitted.id, { output: job.output ?? 'video', ...(job.outputNode ? { outputNode: job.outputNode } : {}) });
    return { backendJobId: submitted.id };
  }

  async get(id: string, want?: OutputWanted): Promise<BackendJob> {
    if (!isJobId(id)) return lost(id);
    let job: Job;
    try {
      job = await this.client.jobs.get(id);
    } catch (error) {
      if (error instanceof NotFound) return lost(id);
      throw new BackendError('backend-unavailable', true, describe(error));
    }
    const value = job.progress?.value;
    const progress = typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    switch (job.status) {
      case 'queued':
      case 'running':
        return { id, state: job.status, progress };
      case 'canceling':
      case 'canceled':
        return { id, state: 'canceled', progress };
      case 'failed': {
        // A stable code only: the message and the traceback hold pod paths.
        const code = job.error?.code;
        return { id, state: 'failed', progress, error: code && ERROR_CODE.test(code) ? code : 'failed' };
      }
      case 'expired':
        return { id, state: 'failed', progress, error: 'expired' };
      case 'succeeded': {
        const wanted = want ?? this.wanted.get(id) ?? {};
        const kind = wanted.output ?? 'video';
        const result = pickOutput(job.outputs, kind, wanted.outputNode);
        if (!result) return { id, state: 'failed', progress: 1, error: 'no-output' };
        try {
          return { id, state: 'succeeded', progress: 1, outputPath: await this.download(id, result, kind) };
        } catch (error) {
          // The proxy no longer has the clip: waiting will not bring it back.
          if (error instanceof NotFound) return { id, state: 'failed', progress: 1, error: 'no-output' };
          throw new BackendError('backend-unavailable', true, describe(error));
        }
      }
      default:
        // Polling would wait forever on a status this version does not know.
        console.error(`[montagio] job ${id}: the proxy reports an unknown status ${JSON.stringify(job.status)}`);
        return { id, state: 'failed', progress, error: 'unexpected-status' };
    }
  }

  /** Download the output once, however many polls ask at the same time; a file already on disk is reused. */
  private download(id: string, output: Output, kind: OutputKind): Promise<string> {
    const inFlight = this.downloads.get(id);
    if (inFlight) return inFlight;
    const pending = this.downloadOnce(id, output, kind);
    this.downloads.set(id, pending);
    const settle = () => {
      if (this.downloads.get(id) === pending) this.downloads.delete(id);
    };
    pending.then(settle, settle);
    return pending;
  }

  private async downloadOnce(id: string, output: Output, kind: OutputKind): Promise<string> {
    // The output name only lends its extension, from a short list: it never becomes a path.
    const extension = extname(output.name).toLowerCase();
    const target = join(this.opts.outputsDir, `${id}${EXTENSIONS[kind].has(extension) ? extension : '.bin'}`);
    try {
      await access(target);
      return target;
    } catch {
      // not downloaded yet
    }
    await mkdir(this.opts.outputsDir, { recursive: true });
    const partial = `${target}.part`;
    try {
      await output.toFile(partial, { timeoutMs: this.opts.downloadTimeoutMs ?? CLIP_DOWNLOAD_TIMEOUT_MS });
      await rename(partial, target);
    } finally {
      await rm(partial, { force: true });
    }
    return target;
  }

  async cancel(id: string): Promise<void> {
    if (!isJobId(id)) return;
    try {
      await (await this.client.jobs.get(id)).cancel();
    } catch (error) {
      if (error instanceof NotFound) return;
      throw new BackendError('backend-unavailable', true, describe(error));
    }
  }
}
