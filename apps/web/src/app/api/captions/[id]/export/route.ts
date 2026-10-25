import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { fromThisSite, readJsonBody } from '@/server/body';
import { CaptionsNotFound, startExport } from '@/server/captions';
import { captionsOffered } from '@/server/extensions';
import { jobFailureResponse } from '@/server/jobs';

/** A 9:16 export of a transcription job: the corrected text burned in, in a style; 202, then its state is polled. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  if (!(await captionsOffered())) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: read.reason === 'too-large' ? 'invalid-input' : 'invalid-json' }, { status: 400 });
  try {
    return Response.json(await startExport((await context.params).id, read.value), { status: 202 });
  } catch (error) {
    if (error instanceof CaptionsNotFound) return Response.json({ error: 'not-found' }, { status: 404 });
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
