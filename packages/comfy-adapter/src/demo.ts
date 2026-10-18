import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IDEMPOTENCY_WINDOW_MS, type BackendJob, type GenerationBackend, type SubmitJob } from './backend';

type DemoJob = { presetId: string; startedAt: number; canceledAt?: number };

/**
 * Backend that needs no GPU: it simulates progress over `durationMs` and
 * returns a pre-rendered clip for the preset (or `_default.mp4`). Jobs live in
 * memory, so a restarted server reports them as lost.
 */
export class DemoBackend implements GenerationBackend {
  readonly kind = 'demo' as const;
  private readonly jobs = new Map<string, DemoJob>();
  /** Job started by each idempotency key, kept for the idempotency window and no longer. */
  private readonly submissions = new Map<string, { at: number; backendJobId: string }>();
  private readonly now: () => number;

  constructor(private readonly opts: { clipsDir: string; durationMs: number; now?: () => number }) {
    this.now = opts.now ?? Date.now;
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
    this.jobs.set(backendJobId, { presetId: job.presetId, startedAt: now });
    this.submissions.set(job.idempotencyKey, { at: now, backendJobId });
    return { backendJobId };
  }

  async get(backendJobId: string): Promise<BackendJob> {
    const job = this.jobs.get(backendJobId);
    if (!job) return { id: backendJobId, state: 'failed', progress: 0, error: 'lost' };

    const finishedAt = job.startedAt + this.opts.durationMs;
    if (job.canceledAt !== undefined && job.canceledAt < finishedAt) {
      return { id: backendJobId, state: 'canceled', progress: this.progressAt(job, job.canceledAt) };
    }
    const now = this.now();
    if (now >= finishedAt) {
      return { id: backendJobId, state: 'succeeded', progress: 1, outputPath: this.clipFor(job.presetId) };
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

  private clipFor(presetId: string): string {
    const clip = join(this.opts.clipsDir, `${presetId}.mp4`);
    return existsSync(clip) ? clip : join(this.opts.clipsDir, '_default.mp4');
  }
}
