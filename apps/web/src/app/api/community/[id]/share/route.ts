import { shareFileName } from '@/lib/community';
import { shareOf } from '@/server/community';

/** The share file of an entry: its settings, never this machine's photo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const shared = await shareOf((await params).id);
  if (!shared) return Response.json({ error: 'not-found' }, { status: 404 });
  return new Response(`${JSON.stringify(shared, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${shareFileName(shared.title)}"`,
    },
  });
}
