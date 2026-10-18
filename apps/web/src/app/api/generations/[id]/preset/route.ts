import { readPresetText } from '@/server/store';

/** The preset a remix was rendered from, exactly as it was sent: the Studio reopens it in the editor. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = await readPresetText(id);
  if (text === null) return Response.json({ error: 'not-found' }, { status: 404 });
  return new Response(text, {
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': `attachment; filename="montagio-remix-${id}.yaml"`,
    },
  });
}
