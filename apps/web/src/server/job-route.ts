import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from './body';
import { withDataWrite } from './data-purge';
import { jobFailureResponse, jobs, jobSummary, type JobTask } from './jobs';

/**
 * The POST handler of a job route (/api/images, /api/edits, /api/effects…): the same
 * rules as /api/generations, the Idempotency-Key header required, the body capped.
 */
export function jobCreationRoute(task: JobTask, fromParams?: (params: Record<string, string>) => Record<string, unknown>) {
  return async function POST(request: Request, context?: { params: Promise<Record<string, string>> }): Promise<Response> {
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return Response.json({ error: 'missing-idempotency-key' }, { status: 400 });
    const read = await readJsonBody(request, MAX_REQUEST_BYTES, { allowEmpty: fromParams !== undefined });
    if (!read.ok) return Response.json({ error: read.reason === 'too-large' ? 'invalid-input' : 'invalid-json' }, { status: 400 });
    const sent = read.value && typeof read.value === 'object' ? (read.value as Record<string, unknown>) : {};
    // The URL's own ids win over the body's (/api/sequences/:id/music names its film).
    const body = fromParams && context ? { ...sent, ...fromParams(await context.params) } : sent;
    try {
      const { record, created } = await withDataWrite(() => jobs.create(task, body, idempotencyKey.slice(0, 200)));
      return Response.json(jobSummary(record), { status: created ? 201 : 200 });
    } catch (error) {
      const failure = jobFailureResponse(error);
      if (failure) return failure;
      throw error;
    }
  };
}
