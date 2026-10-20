import { ensureTools } from '@montagio/sequence';
import { readBodyBytes } from '@/server/body';
import { JobError } from '@/server/errors';
import { requireExtension } from '@/server/extensions';
import { mediaUrlFor } from '@/server/generations';
import { videoPath } from '@/server/tasks/files';
import { MAX_VIDEO_FORM_BYTES, saveVideoUpload, UploadError } from '@/server/uploads';

/** A reference clip for a motion transfer: prepared once (5 s at most, 16 fps, silent), then its kept length. */
export async function POST(request: Request) {
  // Nothing is read, nor FFmpeg started, for an extension this server does not show.
  try {
    await requireExtension('motion');
  } catch (error) {
    if (error instanceof JobError) return Response.json({ error: error.code }, { status: 404 });
    throw error;
  }
  // The body is read up to the cap, never whole: a 2 GB phone video is cut off at 50 MB.
  const bytes = await readBodyBytes(request, MAX_VIDEO_FORM_BYTES);
  if (!bytes) return Response.json({ error: 'videos are limited to 50 MB' }, { status: 413 });
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch {
    return Response.json({ error: 'invalid-input' }, { status: 400 });
  }
  const file = form.get('video');
  if (!(file instanceof File)) return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  try {
    const meta = await saveVideoUpload(file);
    return Response.json({ ...meta, url: mediaUrlFor(videoPath(meta.videoRef)) }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.status === 400 ? 'invalid-input' : error.message }, { status: error.status });
    throw error;
  }
}
