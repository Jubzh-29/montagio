import { shareState } from '@/server/share';

/** The state of a 9:16 share: running, then succeeded with its clip, or failed. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const state = await shareState((await context.params).id);
  return state ? Response.json(state) : Response.json({ error: 'not-found' }, { status: 404 });
}
