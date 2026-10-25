import { exportState } from '@/server/captions';
import { experimentalFeatures } from '@/server/extensions';

/** The state of a 9:16 export: running, then succeeded with its clip, or failed. */
export async function GET(_request: Request, context: { params: Promise<{ id: string; exportId: string }> }): Promise<Response> {
  if (!experimentalFeatures().includes('captions')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const { id, exportId } = await context.params;
  const state = await exportState(id, exportId);
  return state ? Response.json(state) : Response.json({ error: 'not-found' }, { status: 404 });
}
