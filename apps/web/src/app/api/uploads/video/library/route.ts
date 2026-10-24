import { ensureTools } from '@montagio/sequence';
import { visibleExtensions } from '@/server/extensions';
import { mediaUrlFor } from '@/server/generations';
import { libraryMotionPath, libraryMotions } from '@/server/motions';
import { videoPath } from '@/server/tasks/files';
import { saveLibraryVideo } from '@/server/uploads';

/** A motion of the library taken as the reference clip ({ id }): the same answer as a clip sent. */
export async function POST(request: Request) {
  const shown = await visibleExtensions();
  if (!shown.includes('motion') && !shown.includes('restyle')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const motion = (await libraryMotions()).find((entry) => entry.id === body?.id);
  if (!motion) return Response.json({ error: 'not-found' }, { status: 404 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  try {
    const meta = await saveLibraryVideo(libraryMotionPath(motion.id));
    return Response.json({ ...meta, url: mediaUrlFor(videoPath(meta.videoRef)) }, { status: 201 });
  } catch {
    return Response.json({ error: 'not-found' }, { status: 404 });
  }
}
