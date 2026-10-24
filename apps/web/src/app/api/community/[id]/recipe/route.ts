import { recipeFileName } from '@/lib/community';
import { recipeOf } from '@/server/community';

/** The recipe of an entry, as a file to share: its settings, never this machine's photo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const recipe = await recipeOf((await params).id);
  if (!recipe) return Response.json({ error: 'not-found' }, { status: 404 });
  return new Response(`${JSON.stringify(recipe, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${recipeFileName(recipe.title)}"`,
    },
  });
}
