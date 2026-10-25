import { namesThisSite } from '@/server/body';
import { deleteCharacter, getCharacter } from '@/server/characters';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const character = await getCharacter((await params).id);
  return character ? Response.json(character) : Response.json({ error: 'not-found' }, { status: 404 });
}

/** Forget a character; the photos it made stay in the history. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  return (await deleteCharacter((await params).id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'not-found' }, { status: 404 });
}
