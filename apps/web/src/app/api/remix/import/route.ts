import { ensureTools } from '@montagio/sequence';
import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { fromThisSite, readJsonBody } from '@/server/body';
import { visibleExtensions } from '@/server/extensions';
import { importLink, LINK_IMPORT_STATUS, LinkImportError, linkImportOffered, ytDlpVersion } from '@/server/link-import';
import { remixSummary } from '@/server/remix';
import { UploadError } from '@/server/uploads';

/** The route exists only in the app on a machine of its own, with the remix shown: else as if it were not there. */
async function offered(): Promise<Response | null> {
  if (!linkImportOffered()) return Response.json({ error: 'not-found' }, { status: 404 });
  if (!(await visibleExtensions()).includes('remix')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  return null;
}

/** Whether yt-dlp answers on this machine, and its version: the page shows the link field only then. */
export async function GET() {
  const refused = await offered();
  if (refused) return refused;
  const version = await ytDlpVersion();
  return Response.json({ available: version !== null, ...(version ? { version } : {}) });
}

/**
 * A trend imported from its link ({ url, rights: true }): TikTok, Instagram or a YouTube Short only,
 * fetched by yt-dlp on this machine, 60 s and 50 MB at most, then prepared as a file sent is.
 */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const refused = await offered();
  if (refused) return refused;
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: 'invalid-input' }, { status: 400 });
  const { url, rights } = (read.value ?? {}) as { url?: unknown; rights?: unknown };
  // The user's word that they may use the video, before anything is fetched.
  if (rights !== true) return Response.json({ error: 'rights-required' }, { status: 400 });
  try {
    await ensureTools();
  } catch {
    return Response.json({ error: 'ffmpeg-missing' }, { status: 503 });
  }
  try {
    return Response.json(await remixSummary(await importLink(url)), { status: 201 });
  } catch (error) {
    if (error instanceof LinkImportError) {
      if (error.code === 'link-import-failed') console.warn(`[montagio] a link import failed: ${error.message}`);
      return Response.json({ error: error.code }, { status: LINK_IMPORT_STATUS[error.code] });
    }
    if (error instanceof UploadError) return Response.json({ error: 'invalid-input' }, { status: 400 });
    throw error;
  }
}
