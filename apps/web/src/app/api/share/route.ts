import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { fromThisSite, readJsonBody } from '@/server/body';
import { jobFailureResponse } from '@/server/jobs';
import { ShareSourceNotFound, startShare } from '@/server/share';

/** The 9:16 clip of a finished result, to post: 202, then its state is polled. */
export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: read.reason === 'too-large' ? 'invalid-input' : 'invalid-json' }, { status: 400 });
  try {
    return Response.json(await startShare(read.value), { status: 202 });
  } catch (error) {
    if (error instanceof ShareSourceNotFound) return Response.json({ error: 'not-found' }, { status: 404 });
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
