import { ensureTools } from '@montagio/sequence';
import { namesThisSite, readFormBody } from '@/server/body';
import { visibleExtensions } from '@/server/extensions';
import { remixSummary, saveRemixUpload } from '@/server/remix';
import { MAX_VIDEO_FORM_BYTES, UploadError } from '@/server/uploads';

/**
 * A trend to remix, sent from this browser (field "video"): its first 60 s kept at a constant frame
 * rate, its shots found by FFmpeg. Answers its numbers and its shots, each with its first frame.
 */
export async function POST(request: Request) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  // Nothing is read, nor FFmpeg started, while the remix is hidden.
  if (!(await visibleExtensions()).includes('remix')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  // The body is read up to the cap, never whole.
  const body = await readFormBody(request, MAX_VIDEO_FORM_BYTES);
  if (!body.ok && body.reason === 'too-large') return Response.json({ error: 'videos are limited to 50 MB' }, { status: 413 });
  if (!body.ok) return Response.json({ error: 'invalid-input' }, { status: 400 });
  const file = body.form.get('video');
  if (!(file instanceof File)) return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  try {
    return Response.json(await remixSummary(await saveRemixUpload(file)), { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.status === 400 ? 'invalid-input' : error.message }, { status: error.status });
    throw error;
  }
}
