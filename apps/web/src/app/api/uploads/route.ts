import { saveUpload, UploadError } from '@/server/uploads';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'expected multipart/form-data with an "image" field' }, { status: 400 });
  }
  const file = form.get('image');
  if (!(file instanceof File)) return Response.json({ error: 'missing "image" file' }, { status: 400 });
  try {
    return Response.json(await saveUpload(file));
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
