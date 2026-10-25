import { captionsInfo } from '@/server/captions';
import { captionsOffered } from '@/server/extensions';

/** The transcript of a transcription job and its 9:16 exports; 404 until it is delivered. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await captionsOffered())) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const info = await captionsInfo((await context.params).id);
  return info ? Response.json(info) : Response.json({ error: 'not-found' }, { status: 404 });
}
