import { communityPresetText } from '@/server/community';

/** The preset text an entry's remixed move was rendered from: the Studio reopens it in the editor. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const text = await communityPresetText((await params).id);
  if (text === null) return Response.json({ error: 'not-found' }, { status: 404 });
  return new Response(text, { headers: { 'content-type': 'application/yaml; charset=utf-8' } });
}
