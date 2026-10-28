import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { fromThisSite, readJsonBody } from '@/server/body';
import { DataPurgeError, purgeStudioData } from '@/server/data-purge';

export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const read = await readJsonBody(request, MAX_REQUEST_BYTES, { allowEmpty: true });
  if (!read.ok) return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    await purgeStudioData();
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof DataPurgeError) {
      const status = error.code === 'remote-purge-incomplete' ? 502 : 409;
      return Response.json({ error: error.code }, { status });
    }
    throw error;
  }
}
