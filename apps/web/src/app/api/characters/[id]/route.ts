import { deleteCharacter, getCharacter } from '@/server/characters';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const character = await getCharacter((await params).id);
  return character ? Response.json(character) : Response.json({ error: 'not-found' }, { status: 404 });
}

/** Forget a character; the photos it made stay in the history. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return (await deleteCharacter((await params).id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'not-found' }, { status: 404 });
}
