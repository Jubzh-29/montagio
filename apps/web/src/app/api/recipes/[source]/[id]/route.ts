import { isRecipeSource } from '@/lib/recipe-url';
import { deliveredSha256, recipeOf } from '@/server/recipe';

/** The recipe of a result: its workflow, weights, seed and stack, and the sha256 of the file it delivered. `?download=1` saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params;
  if (!isRecipeSource(source)) return Response.json({ error: 'not-found' }, { status: 404 });
  let recipe;
  try {
    recipe = await recipeOf(source, id);
  } catch (error) {
    console.error(`[montagio] the recipe of ${source} ${id} could not be made:`, error);
    return Response.json({ error: 'recipe-unavailable' }, { status: 500 });
  }
  if (!recipe) return Response.json({ error: 'not-found' }, { status: 404 });
  const output = await deliveredSha256(source, id);
  const download = new URL(request.url).searchParams.has('download');
  return new Response(JSON.stringify(output ? { ...recipe, output: { sha256: output } } : recipe, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(download ? { 'content-disposition': `attachment; filename="montagio-recipe-${recipe.task}-${id}.json"` } : {}),
    },
  });
}
