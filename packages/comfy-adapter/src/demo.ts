import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IDEMPOTENCY_WINDOW_MS, type BackendJob, type GenerationBackend, type OutputKind, type OutputWanted, type SubmitJob } from './backend';

/**
 * Makes the file of a job from what it was given (the web layer: a render of the sample photo
 * made on a GPU, or the photo moved by FFmpeg); undefined keeps the pre-rendered file.
 */
export type DemoRender = (job: { presetId: string; output: OutputKind; files: NonNullable<SubmitJob['files']> }) => Promise<string | undefined>;

type DemoDir = 'clipsDir' | 'imagesDir' | 'audioDir' | 'captionsDir';

/** `rendered` is undefined while the render runs, null when it gave nothing. */
type DemoJob = { presetId: string; output: OutputKind; startedAt: number; canceledAt?: number; rendered?: string | null };

/** The pre-rendered file of each kind, and the one used when a job has none of its own. */
const DEMO_FILES: Record<OutputKind, { dir: DemoDir; ext: string }> = {
  video: { dir: 'clipsDir', ext: '.mp4' },
  image: { dir: 'imagesDir', ext: '.png' },
  audio: { dir: 'audioDir', ext: '.flac' },
  file: { dir: 'captionsDir', ext: '.json' },
};

/**
 * Backend that needs no GPU: it simulates progress over `durationMs` and
 * returns what `render` made of the job's files, or else a pre-rendered file of the kind the
 * job delivers: a clip for the preset (or `_default.mp4`), an image (`_default.png`), a sound (`_default.flac`)
 * or the words of a speech (`_default.json`).
 * Jobs live in memory, so a restarted server reports them as lost.
 */
export class DemoBackend implements GenerationBackend {
  readonly kind = 'demo' as const;
  private readonly jobs = new Map<string, DemoJob>();
  /** Job started by each idempotency key, kept for the idempotency window and no longer. */
  private readonly submissions = new Map<string, { at: number; backendJobId: string }>();
  private readonly now: () => number;

  private readonly dirs: Record<DemoDir, string>;

  /** `imagesDir`, `audioDir` and `captionsDir` default to the siblings of `clipsDir` (demo-assets/images, demo-assets/audio, demo-assets/captions). */
  constructor(
    private readonly opts: {
      clipsDir: string;
      imagesDir?: string;
      audioDir?: string;
      captionsDir?: string;
      durationMs: number;
      now?: () => number;
      render?: DemoRender;
    },
  ) {
    this.now = opts.now ?? Date.now;
    this.dirs = {
      clipsDir: opts.clipsDir,
      imagesDir: opts.imagesDir ?? join(opts.clipsDir, '..', 'images'),
      audioDir: opts.audioDir ?? join(opts.clipsDir, '..', 'audio'),
      captionsDir: opts.captionsDir ?? join(opts.clipsDir, '..', 'captions'),
    };
  }

  /** `files` only reach `render`, which starts at once: no model runs. */
  async submit(job: SubmitJob): Promise<{ backendJobId: string }> {
    const now = this.now();
    // Past the window the web layer treats a reused key as a new request: so does the backend.
    for (const [key, entry] of this.submissions) {
      if (now - entry.at >= IDEMPOTENCY_WINDOW_MS) this.submissions.delete(key);
    }
    const known = this.submissions.get(job.idempotencyKey);
    if (known) return { backendJobId: known.backendJobId };
    // The start time is part of the id: a key reused after the window does not reopen its old job.
    const backendJobId = `demo-${createHash('sha256').update(`${job.idempotencyKey}@${now}`).digest('hex').slice(0, 12)}`;
    const demoJob: DemoJob = { presetId: job.presetId, output: job.output ?? 'video', startedAt: now };
    const { render } = this.opts;
    if (render && job.files?.length) {
      demoJob.rendered = undefined;
      render({ presetId: job.presetId, output: demoJob.output, files: job.files }).then(
        (path) => (demoJob.rendered = path ?? null),
        (error: unknown) => {
          console.warn(`[montagio] demo job ${backendJobId}: no render of its photo, the pre-rendered file instead`, error);
          demoJob.rendered = null;
        },
      );
    } else {
      demoJob.rendered = null;
    }
    this.jobs.set(backendJobId, demoJob);
    this.submissions.set(job.idempotencyKey, { at: now, backendJobId });
    return { backendJobId };
  }

  async get(backendJobId: string, want?: OutputWanted): Promise<BackendJob> {
    const job = this.jobs.get(backendJobId);
    if (!job) return { id: backendJobId, state: 'failed', progress: 0, error: 'lost' };

    const finishedAt = job.startedAt + this.opts.durationMs;
    if (job.canceledAt !== undefined && job.canceledAt < finishedAt) {
      return { id: backendJobId, state: 'canceled', progress: this.progressAt(job, job.canceledAt) };
    }
    const now = this.now();
    const output = want?.output ?? job.output;
    // The render of the job's own output may outlast the simulated time: the job waits for it at 99 %.
    const own = output === job.output ? job.rendered : null;
    if (now >= finishedAt && own === undefined) return { id: backendJobId, state: 'running', progress: 0.99 };
    if (now >= finishedAt) {
      return { id: backendJobId, state: 'succeeded', progress: 1, outputPath: own ?? this.fileFor(job.presetId, output) };
    }
    return { id: backendJobId, state: 'running', progress: this.progressAt(job, now) };
  }

  async cancel(backendJobId: string): Promise<void> {
    const job = this.jobs.get(backendJobId);
    if (job && job.canceledAt === undefined) job.canceledAt = this.now();
  }

  private progressAt(job: DemoJob, time: number): number {
    return Math.min(1, Math.max(0, (time - job.startedAt) / this.opts.durationMs));
  }

  private fileFor(presetId: string, output: OutputKind): string {
    const { dir, ext } = DEMO_FILES[output];
    const own = join(this.dirs[dir], `${presetId}${ext}`);
    return existsSync(own) ? own : join(this.dirs[dir], `_default${ext}`);
  }
}
