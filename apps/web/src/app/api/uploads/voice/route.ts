import { ensureTools } from '@montagio/sequence';
import { namesThisSite, readFormBody } from '@/server/body';
import { JobError } from '@/server/errors';
import { requireExtension } from '@/server/extensions';
import { MAX_VOICE_FORM_BYTES, saveVoiceUpload, UploadError } from '@/server/uploads';

/** A voice sample for the avatar: prepared once (20 s at most, mono FLAC), then its kept length. */
export async function POST(request: Request) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  // Nothing is read, nor FFmpeg started, for an extension this server does not show.
  try {
    await requireExtension('avatar');
  } catch (error) {
    if (error instanceof JobError) return Response.json({ error: error.code }, { status: 404 });
    throw error;
  }
  // The body is read up to the cap, never whole.
  const body = await readFormBody(request, MAX_VOICE_FORM_BYTES);
  if (!body.ok && body.reason === 'too-large') return Response.json({ error: 'voice samples are limited to 10 MB' }, { status: 413 });
  if (!body.ok) return Response.json({ error: 'invalid-input' }, { status: 400 });
  const file = body.form.get('audio');
  if (!(file instanceof File)) return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  try {
    return Response.json(await saveVoiceUpload(file), { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.status === 400 ? 'invalid-input' : error.message }, { status: error.status });
    throw error;
  }
}
