import { advanceSequence } from '@/server/sequences';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await advanceSequence(id);
  if (!record) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json(record);
}
