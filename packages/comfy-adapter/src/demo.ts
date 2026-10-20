import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IDEMPOTENCY_WINDOW_MS, type BackendJob, type GenerationBackend, type OutputKind, type OutputWanted, type SubmitJob } from './backend';

type DemoJob = { presetId: string; output: OutputKind; startedAt: number; canceledAt?: number };

/** The pre-rendered file of each kind, and the one used when a job has none of its own. */
const DEMO_FILES: Record<OutputKind, { dir: 'clipsDir' | 'imagesDir' | 'audioDir'; ext: string }> = {
  video: { dir: 'clipsDir', ext: '.mp4' },
  image: { dir: 'imagesDir', ext: '.png' },
  audio: { dir: 'audioDir', ext: '.flac' },
};

/**
 * Backend that needs no GPU: it simulates progress over `durationMs` and
 * returns a pre-rendered file of the kind the job delivers: a clip for the preset
 * (or `_default.mp4`), an image (`_default.png`) or a sound (`_default.flac`).
 * Jobs live in memory, so a restarted server reports them as lost.
 */
export class DemoBackend implements GenerationBackend {
  readonly kind = 'demo' as const;
  private readonly jobs = new Map<string, DemoJob>();
  /** Job started by each idempotency key, kept for the idempotency window and no longer. */
  private readonly submissions = new Map<string, { at: number; backendJobId: string }>();
  private readonly now: () => number;

  private readonly dirs: Record<'clipsDir' | 'imagesDir' | 'audioDir', string>;

  /** `imagesDir` and `audioDir` default to the siblings of `clipsDir` (demo-assets/images, demo-assets/audio). */
  constructor(
    private readonly opts: { clipsDir: string; imagesDir?: string; audioDir?: string; durationMs: number; now?: () => number },
  ) {
    this.now = opts.now ?? Date.now;
    this.dirs = {
      clipsDir: opts.clipsDir,
      imagesDir: opts.imagesDir ?? join(opts.clipsDir, '..', 'images'),
      audioDir: opts.audioDir ?? join(opts.clipsDir, '..', 'audio'),
    };
  }

  /** `files` is ignored: the demo renders nothing. */
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
    this.jobs.set(backendJobId, { presetId: job.presetId, output: job.output ?? 'video', startedAt: now });
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
    if (now >= finishedAt) {
      return { id: backendJobId, state: 'succeeded', progress: 1, outputPath: this.fileFor(job.presetId, want?.output ?? job.output) };
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
