import { parseShared, SHARE_PRESET_MAX } from '@/lib/community';
import { fromThisSite, readJsonBody } from '@/server/body';
import { importShared } from '@/server/community';
import { jobFailureResponse } from '@/server/jobs';

/** Add a share file someone sent (a .montagio-share.json file's content) to this gallery. */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const read = await readJsonBody(request, SHARE_PRESET_MAX + 16 * 1024);
  const shared = read.ok ? parseShared(read.value) : null;
  if (!shared) return Response.json({ error: 'invalid-share' }, { status: 400 });
  try {
    return Response.json(await importShared(shared), { status: 201 });
  } catch (error) {
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
