import { getCommunityEntry, removeFromCommunity } from '@/server/community';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entry = await getCommunityEntry((await params).id);
  return entry ? Response.json(entry) : Response.json({ error: 'not-found' }, { status: 404 });
}

/** Take an entry published or imported here out of the gallery; the history keeps its creation. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return (await removeFromCommunity((await params).id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'not-found' }, { status: 404 });
}
