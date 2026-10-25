import type { CompactRecipe, Recipe } from './types';

/** The size a file's tags carry at most: well under a Windows command line, which FFmpeg's arguments travel on. */
export const COMPACT_MAX_BYTES = 8192;

/** JSON in printable ASCII: every other character as \uXXXX, so a PNG tEXt chunk (Latin-1) or an MP4 tag keeps it as is. */
const ascii = (value: unknown) => JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * The recipe a file carries: the request that makes it again and the hashes that prove it, without the
 * workflow bodies. Past `maxBytes` the remix text goes first, then the request, and `truncated` says so.
 */
export function compactRecipe(recipe: Recipe, maxBytes = COMPACT_MAX_BYTES): string {
  const compact: CompactRecipe = {
    schema: recipe.schema,
    compact: true,
    kind: recipe.kind,
    task: recipe.task,
    name: recipe.name,
    createdAt: recipe.createdAt,
    backend: recipe.backend,
    seed: recipe.seed,
    ...(recipe.preset ? { preset: recipe.preset } : {}),
    ...(recipe.request ? { request: recipe.request } : {}),
    steps: recipe.steps.map((step) => ({ name: step.name, workflowSha256: step.workflowSha256, inputs: step.inputs.map(({ from, sha256 }) => ({ from, sha256 })) })),
    post: recipe.post,
    weights: recipe.weights.map(({ id, sha256 }) => ({ id, ...(sha256 ? { sha256 } : {}) })),
    stack: { montagio: recipe.stack.montagio, comfyui: recipe.stack.comfyui },
  };
  const shrink: ((value: CompactRecipe) => CompactRecipe)[] = [
    (value) => {
      if (!value.request || !('presetYaml' in value.request.body)) return value;
      const { presetYaml: _dropped, ...body } = value.request.body;
      return { ...value, truncated: true, request: { ...value.request, body } };
    },
    ({ request: _dropped, ...value }) => ({ ...value, truncated: true }),
    (value) => ({ ...value, truncated: true, weights: [], steps: value.steps.map(({ name, workflowSha256 }) => ({ name, workflowSha256, inputs: [] })) }),
  ];
  let value = compact;
  let text = ascii(value);
  for (const step of shrink) {
    if (text.length <= maxBytes) return text;
    value = step(value);
    text = ascii(value);
  }
  if (text.length > maxBytes) throw new Error(`a compact recipe does not fit in ${maxBytes} bytes`);
  return text;
}
