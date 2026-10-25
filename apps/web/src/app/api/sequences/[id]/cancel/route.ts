import { namesThisSite } from '@/server/body';
import { cancelSequence } from '@/server/sequences';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const { id } = await params;
  const record = await cancelSequence(id);
  if (!record) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json(record);
}
