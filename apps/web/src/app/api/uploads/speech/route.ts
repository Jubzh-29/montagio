import { ensureTools } from '@montagio/sequence';
import { namesThisSite, readFormBody } from '@/server/body';
import { JobError } from '@/server/errors';
import { requireExtension } from '@/server/extensions';
import { mediaUrlFor } from '@/server/generations';
import { speechPath } from '@/server/tasks/files';
import { MAX_VIDEO_FORM_BYTES, saveSpeechUpload, UploadError } from '@/server/uploads';

/** A video whose voice will change: its first 30 s kept with their sound, then its length. */
export async function POST(request: Request) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  // Nothing is read, nor FFmpeg started, for an extension this server does not show.
  try {
    await requireExtension('avatar');
  } catch (error) {
    if (error instanceof JobError) return Response.json({ error: error.code }, { status: 404 });
    throw error;
  }
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
    const meta = await saveSpeechUpload(file);
    return Response.json({ ...meta, url: mediaUrlFor(speechPath(meta.speechRef)) }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.status === 400 ? 'invalid-input' : error.message }, { status: error.status });
    throw error;
  }
}
