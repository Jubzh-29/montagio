import { visibleExtensions } from '@/server/extensions';
import { libraryMotionSummaries } from '@/server/motions';

/** The motion library: reference motions made by Montagio from fictional characters (none when no extension takes a clip). */
export async function GET() {
  const shown = await visibleExtensions();
  if (!shown.includes('motion') && !shown.includes('restyle')) return Response.json([]);
  return Response.json(await libraryMotionSummaries());
}
