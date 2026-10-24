/** What a recipe is read from: a camera clip, a job (photo, effect, hook, avatar, HD…), a film. */
export const RECIPE_SOURCES = ['generation', 'job', 'sequence'] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

export const isRecipeSource = (value: string): value is RecipeSource => (RECIPE_SOURCES as readonly string[]).includes(value);

/** The recipe of a result, served by /api/recipes (a static file in the showcase). */
export const recipeUrlOf = (source: RecipeSource, id: string) => `/api/recipes/${source}/${id}`;
