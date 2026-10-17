import { getGeneration } from '@/server/generations';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getGeneration(id);
  if (!record) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json(record);
}
