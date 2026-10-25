import { ensureTools } from '@montagio/sequence';
import { fromThisSite } from '@/server/body';
import { visibleExtensions } from '@/server/extensions';
import { remixSummary, saveRemixSample } from '@/server/remix';

/**
 * The sample trend of the Remix page: three moves of the Motion library cut together by Montagio, from
 * fictional characters. With a photo nobody imported, no rights to confirm.
 */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  if (!(await visibleExtensions()).includes('remix')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  return Response.json(await remixSummary(await saveRemixSample()), { status: 201 });
}
