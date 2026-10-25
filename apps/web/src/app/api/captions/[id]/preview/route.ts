import { readFile } from 'node:fs/promises';
import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from '@/server/body';
import { CaptionsNotFound, previewFrame } from '@/server/captions';
import { captionsOffered } from '@/server/extensions';
import { jobFailureResponse } from '@/server/jobs';

/** One frame of the 9:16 export a text and a style would give (PNG, 540x960). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await captionsOffered())) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: read.reason === 'too-large' ? 'invalid-input' : 'invalid-json' }, { status: 400 });
  try {
    const png = await readFile(await previewFrame((await context.params).id, read.value));
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof CaptionsNotFound) return Response.json({ error: 'not-found' }, { status: 404 });
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
