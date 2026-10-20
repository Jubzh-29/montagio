import { ensureTools } from '@montagio/sequence';
import { mediaUrlFor } from '@/server/generations';
import { videoPath } from '@/server/tasks/files';
import { saveVideoUpload, UploadError } from '@/server/uploads';

/** A reference clip for a motion transfer: prepared once (5 s at most, 16 fps, silent), then its kept length. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
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
