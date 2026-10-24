import { parseRecipe, RECIPE_PRESET_MAX } from '@/lib/community';
import { fromThisSite, readJsonBody } from '@/server/body';
import { importRecipe } from '@/server/community';
import { jobFailureResponse } from '@/server/jobs';

/** Add a recipe someone shared (a .montagio.json file's content) to this gallery. */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const read = await readJsonBody(request, RECIPE_PRESET_MAX + 16 * 1024);
  const recipe = read.ok ? parseRecipe(read.value) : null;
  if (!recipe) return Response.json({ error: 'invalid-recipe' }, { status: 400 });
  try {
    return Response.json(await importRecipe(recipe), { status: 201 });
  } catch (error) {
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
