import { namesThisSite, readFormBody } from '@/server/body';
import { MAX_UPLOAD_FORM_BYTES, saveUpload, UploadError } from '@/server/uploads';

export async function POST(request: Request) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  // The body is read up to the cap, never whole: a 2 GB file is cut off past 10 MB.
  const body = await readFormBody(request, MAX_UPLOAD_FORM_BYTES);
  if (!body.ok && body.reason === 'too-large') return Response.json({ error: 'images are limited to 10 MB' }, { status: 413 });
  if (!body.ok) return Response.json({ error: 'expected multipart/form-data with an "image" field' }, { status: 400 });
  const file = body.form.get('image');
  if (!(file instanceof File)) return Response.json({ error: 'missing "image" file' }, { status: 400 });
  try {
    return Response.json(await saveUpload(file));
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
