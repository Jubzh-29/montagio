import { namesThisSite } from '@/server/body';
import { JobError } from '@/server/errors';
import { requireExtension } from '@/server/extensions';
import { mediaUrlFor } from '@/server/generations';
import { videoPath } from '@/server/tasks/files';
import { saveSampleVideo } from '@/server/uploads';

/**
 * The sample reference clip of the Motion tab: a dance Wan 2.2 5B made (no real person), copied by
 * the server as a prepared clip of origin "sample". With a photo that is not an import, no rights to confirm.
 */
export async function POST(request?: Request) {
  if (request && !namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  try {
    await requireExtension('motion');
  } catch (error) {
    if (error instanceof JobError) return Response.json({ error: error.code }, { status: 404 });
    throw error;
  }
  const meta = await saveSampleVideo();
  return Response.json({ ...meta, url: mediaUrlFor(videoPath(meta.videoRef)) }, { status: 201 });
}
