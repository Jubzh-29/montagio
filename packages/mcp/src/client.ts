import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Config } from './config';
import { isRetryable, ToolFailure } from './errors';

// The shapes below mirror apps/web/src/lib/api-types.ts: the app's HTTP API is the contract.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ClientDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  uuid?: () => string;
};

export type Aspect = '16:9' | '9:16' | '1:1';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export const TERMINAL_STATES: ReadonlySet<JobState> = new Set<JobState>(['succeeded', 'failed', 'canceled']);
/** Failed polls in a row (app or backend out of reach) before a tool gives up, as in the Studio. */
export const MAX_POLL_FAILURES = 4;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const VIDEO_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

/** POST /api/uploads, /api/uploads/sample. */
export type UploadResult = {
  imageRef: string;
  width: number;
  height: number;
  aspect: Aspect;
  origin: string;
  /** The photo is, or derives from, an imported one: an edit, effect, hook or avatar on it needs consent. */
  personal: boolean;
};

/** A reference motion of the library (GET /api/motions): made by Montagio from a fictional character. */
export type LibraryMotion = { id: string; name: string; description: string; duration_s: number; previewUrl: string; posterUrl?: string };

/** POST /api/uploads/video: the reference clip of a motion transfer, or the clip of a restyle, cut to 30 s at most. */
export type VideoUploadResult = {
  videoRef: string;
  duration_s: number;
  sourceDuration_s: number;
  frames: number;
  width: number;
  height: number;
  aspect: Aspect;
  url?: string;
};

/** GET /api/jobs/:id and every job route's answer. */
export type JobSummary = {
  id: string;
  task: string;
  state: JobState;
  progress: number;
  outputUrl?: string;
  outputImageRef?: string;
  personal?: boolean;
  stepImageUrl?: string;
  label?: { itemId?: string; name?: string };
  modelId?: string;
  error?: string;
  frames?: number;
  verticalUrl?: string;
  createdAt?: string;
};

/** GET /api/generations/:id and POST /api/generations: a camera clip. */
export type GenerationRecord = {
  id: string;
  presetId: string;
  modelId: string;
  state: JobState;
  progress: number;
  outputUrl?: string;
  error?: string;
  frames?: number;
  createdAt?: string;
};

export type PresetSummary = {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
  poses: string[];
  speed: number;
  defaultModel: string;
};

export type ModelSummary = {
  id: string;
  name: string;
  kind: 'video' | 'image';
  tier: string;
  license: string;
  estimate_s: { '480p': number; '720p'?: number };
};

type Named = { id: string; name: string; license: string };

/** GET /api/extensions: what this installation shows, and its time estimates. */
export type ExtensionsInfo = {
  extensions: string[];
  effects: { id: string; name: string; description: string; previewUrl?: string; estimate_s: number; subjectMax: number; modelName: string; license: string }[];
  hooks: { id: string; name: string; description: string; previewUrl?: string; estimate_s: number; references: 1 | 2; modelName: string; license: string }[];
  estimates: { t2i: number; edit?: number; avatar?: number; music?: number; upscale?: number; motion?: number; restyle?: number; swap?: number };
  editModel?: Named;
  avatarModel?: Named;
  musicModel?: Named;
  upscaleModel?: Named & { maxFrames: number };
  motionModel?: Named;
  restyleModel?: Named;
  swapModel?: Named;
};

/** GET /api/history: one finished creation, newest first. */
export type HistoryItem = {
  key: string;
  source: 'generation' | 'sequence' | 'job';
  kind: 'photo' | 'clip' | 'film';
  task: string;
  name: string;
  modelName: string;
  createdAt: string;
  previewUrl: string;
  downloadUrl: string;
  reprise?: { imageRef?: string; presetId?: string; effectId?: string; hookId?: string; prompt?: string };
};

export type RenderKind = 'job' | 'generation';

/** A render as the tools return it: a job or a camera clip, its URLs absolute. */
export type RenderStatus = {
  kind: RenderKind;
  id: string;
  /** The job's task, or "camera" for a camera clip. */
  task: string;
  state: JobState;
  progress: number;
  outputUrl?: string;
  /** An image output, usable as the imageRef of the next tool. */
  outputImageRef?: string;
  personal?: boolean;
  stepImageUrl?: string;
  name?: string;
  itemId?: string;
  presetId?: string;
  modelId?: string;
  frames?: number;
  verticalUrl?: string;
  error?: string;
  createdAt?: string;
};

export type WaitOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (status: RenderStatus) => void;
};

/** An error code of the app ("consent-required"), as opposed to a sentence. */
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function refusal(status: number, body: unknown): ToolFailure {
  const sent = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const error = typeof sent.error === 'string' ? sent.error : undefined;
  const details: Record<string, unknown> = { status };
  if (Array.isArray(sent.problems)) details.problems = sent.problems;
  if (error && CODE.test(error)) return new ToolFailure(error, undefined, details);
  // The upload routes answer a sentence ("images are limited to 10 MB"), not a code.
  return new ToolFailure(`http-${status}`, error ?? `The app answered HTTP ${status}.`, details);
}

/** A local file to send, checked before it is read: its kind by extension, its size. */
async function readLocalFile(path: string, types: Record<string, string>, maxBytes: number, what: string): Promise<{ blob: Blob; name: string }> {
  const file = resolve(path);
  const type = types[extname(file).toLowerCase()];
  if (!type) throw new ToolFailure('unsupported-file', `${file} is not ${what} (by its extension).`, { path: file });
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    throw new ToolFailure('file-not-found', `There is no file at ${file}.`, { path: file });
  }
  if (size > maxBytes) {
    throw new ToolFailure('file-too-large', `${file} is ${(size / 1024 / 1024).toFixed(1)} MB; the app takes ${maxBytes / 1024 / 1024} MB at most.`, { path: file });
  }
  return { blob: new Blob([new Uint8Array(await readFile(file))], { type }), name: basename(file) };
}

const safeName = (text: string) => text.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 80) || 'file';

/** The Montagio app's HTTP API, as the tools use it. It renders nothing itself. */
export class MontagioClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(
    readonly config: Config,
    deps: ClientDeps = {},
  ) {
    this.fetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? randomUUID;
  }

  /** An app path ("/media/data/…") as an absolute URL; an absolute URL stays as it is. */
  absolute(url: string | undefined): string | undefined {
    return url === undefined ? undefined : new URL(url, `${this.config.baseUrl}/`).href;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch {
      throw new ToolFailure(
        'app-unreachable',
        `Montagio does not answer at ${this.config.baseUrl}. Start the app (./montagio.sh start, or montagio.ps1 start on Windows), then check MONTAGIO_URL.`,
      );
    }
  }

  /** One API call: JSON back, or the app's refusal as a ToolFailure. A job POST carries a fresh Idempotency-Key. */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body: { json?: unknown; form?: FormData } = {},
    idempotent = false,
  ): Promise<{ value: T; headers: Headers }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    let payload: BodyInit | undefined;
    if (body.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body.form) {
      payload = body.form;
    }
    if (idempotent) headers['idempotency-key'] = this.uuid();
    const res = await this.send(`${this.config.baseUrl}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
    const text = await res.text();
    let value: unknown;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch {
      value = undefined;
    }
    if (!res.ok) throw refusal(res.status, value);
    return { value: value as T, headers: res.headers };
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.call<T>('GET', path)).value;
  }

  fromJob(job: JobSummary): RenderStatus {
    return {
      kind: 'job',
      id: job.id,
      task: job.task,
      state: job.state,
      progress: job.progress,
      outputUrl: this.absolute(job.outputUrl),
      outputImageRef: job.outputImageRef,
      personal: job.personal,
      stepImageUrl: this.absolute(job.stepImageUrl),
      name: job.label?.name,
      itemId: job.label?.itemId,
      modelId: job.modelId,
      frames: job.frames,
      verticalUrl: this.absolute(job.verticalUrl),
      error: job.error,
      createdAt: job.createdAt,
    };
  }

  fromGeneration(record: GenerationRecord): RenderStatus {
    return {
      kind: 'generation',
      id: record.id,
      task: 'camera',
      state: record.state,
      progress: record.progress,
      outputUrl: this.absolute(record.outputUrl),
      presetId: record.presetId,
      modelId: record.modelId,
      frames: record.frames,
      error: record.error,
      createdAt: record.createdAt,
    };
  }

  // Read-only catalogue.
  presets = () => this.get<PresetSummary[]>('/api/presets');
  models = () => this.get<ModelSummary[]>('/api/models');
  extensions = () => this.get<ExtensionsInfo>('/api/extensions');
  history = () => this.get<HistoryItem[]>('/api/history');
  motions = () => this.get<LibraryMotion[]>('/api/motions');

  /** A local photo sent to the app (field "image"): an upload is personal, its edits ask for consent. */
  async uploadPhoto(path: string): Promise<UploadResult> {
    const file = await readLocalFile(path, IMAGE_TYPES, MAX_IMAGE_BYTES, 'a PNG, JPEG or WebP image');
    const form = new FormData();
    form.append('image', file.blob, file.name);
    return (await this.call<UploadResult>('POST', '/api/uploads', { form })).value;
  }

  /** The bundled sample photo, copied by the app: no person to ask. */
  async useSample(): Promise<UploadResult> {
    return (await this.call<UploadResult>('POST', '/api/uploads/sample')).value;
  }

  /** A local reference clip for a motion transfer (field "video"). */
  async uploadVideo(path: string): Promise<VideoUploadResult> {
    const file = await readLocalFile(path, VIDEO_TYPES, MAX_VIDEO_BYTES, 'an MP4, WebM or QuickTime video');
    const form = new FormData();
    form.append('video', file.blob, file.name);
    const { value } = await this.call<VideoUploadResult>('POST', '/api/uploads/video', { form });
    return { ...value, ...(value.url ? { url: this.absolute(value.url) } : {}) };
  }

  /** A motion of the library taken as the clip, as if it had been sent. */
  async pickLibraryMotion(id: string): Promise<VideoUploadResult> {
    const { value } = await this.call<VideoUploadResult>('POST', '/api/uploads/video/library', { json: { id } });
    return { ...value, ...(value.url ? { url: this.absolute(value.url) } : {}) };
  }

  /** Start a job (/api/images, /api/edits, /api/effects, /api/hooks, /api/avatars, /api/motion, /api/restyle, /api/swap). */
  async startJob(route: string, body: Record<string, unknown>): Promise<RenderStatus> {
    return this.fromJob((await this.call<JobSummary>('POST', route, { json: body }, true)).value);
  }

  /** Start a camera clip (/api/generations). */
  async startGeneration(body: Record<string, unknown>): Promise<RenderStatus> {
    return this.fromGeneration((await this.call<GenerationRecord>('POST', '/api/generations', { json: body }, true)).value);
  }

  /** HD 1080p of a finished clip: a job of its own; smooth, at twice its frame rate (RIFE). */
  async startUpscale(kind: RenderKind, id: string, smooth: boolean): Promise<RenderStatus> {
    const base = kind === 'generation' ? '/api/generations' : '/api/jobs';
    return this.fromJob((await this.call<JobSummary>('POST', `${base}/${encodeURIComponent(id)}/upscale`, { json: { smooth } }, true)).value);
  }

  /** One poll: the app moves the render forward when it is asked. */
  async status(kind: RenderKind, id: string): Promise<RenderStatus> {
    return kind === 'generation'
      ? this.fromGeneration(await this.get<GenerationRecord>(`/api/generations/${encodeURIComponent(id)}`))
      : this.fromJob(await this.get<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`));
  }

  /** A render by id alone: a job, else a camera clip. */
  async find(id: string): Promise<RenderStatus> {
    try {
      return await this.status('job', id);
    } catch (error) {
      if (!(error instanceof ToolFailure) || error.code !== 'not-found') throw error;
    }
    return this.status('generation', id);
  }

  /** Poll until the render ends, or the timeout: the render then goes on in the app. */
  async wait(start: RenderStatus, options: WaitOptions = {}): Promise<RenderStatus> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const deadline = this.now() + timeoutMs;
    let current = start;
    let failures = 0;
    options.onProgress?.(current);
    while (!TERMINAL_STATES.has(current.state)) {
      if (options.signal?.aborted) throw new ToolFailure('aborted', undefined, { kind: current.kind, id: current.id });
      const left = deadline - this.now();
      if (left <= 0) {
        throw new ToolFailure(
          'timeout',
          `The render is still ${current.state} after ${Math.round(timeoutMs / 60_000)} min. It goes on in the app: call get_job with id "${current.id}" and wait: true to follow it.`,
          { kind: current.kind, id: current.id, state: current.state, progress: current.progress },
        );
      }
      await this.sleep(Math.min(this.config.pollIntervalMs, left));
      try {
        current = await this.status(current.kind, current.id);
        failures = 0;
      } catch (error) {
        if (isRetryable(error) && ++failures < MAX_POLL_FAILURES) continue;
        if (error instanceof ToolFailure) Object.assign(error.details, { kind: current.kind, id: current.id });
        throw error;
      }
      options.onProgress?.(current);
    }
    return current;
  }

  /** Save a finished render's file into MONTAGIO_MCP_OUT; its absolute path. Only files of this app are fetched. */
  async download(status: RenderStatus): Promise<string> {
    const outDir = this.config.outDir;
    if (!outDir || !status.outputUrl) throw new ToolFailure('download-failed', 'Nothing to download.');
    const url = new URL(status.outputUrl);
    if (url.origin !== new URL(this.config.baseUrl).origin) {
      throw new ToolFailure('download-failed', `${url.href} is not a file of this Montagio.`);
    }
    const res = await this.send(url.href, { method: 'GET' });
    if (!res.ok) throw new ToolFailure('download-failed', `The app answered HTTP ${res.status} for ${url.href}.`);
    const ext = extname(url.pathname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    const file = join(outDir, `montagio-${safeName(status.task)}-${safeName(status.id)}${ext}`);
    await mkdir(outDir, { recursive: true });
    await writeFile(file, new Uint8Array(await res.arrayBuffer()));
    return file;
  }

  /** The ComfyUI workflow (API format) behind a clip or an image, and the file name the app gives it. */
  async workflow(id: string): Promise<{ workflow: unknown; filename: string }> {
    const { value, headers } = await this.call<unknown>('GET', `/api/workflows/${encodeURIComponent(id)}`);
    const named = /filename="([^"]+)"/.exec(headers.get('content-disposition') ?? '')?.[1];
    const clean = named ? basename(named).replace(/[^A-Za-z0-9._-]+/g, '-') : '';
    return { workflow: value, filename: /^[A-Za-z0-9]/.test(clean) ? clean : `montagio-${safeName(id)}.json` };
  }
}
