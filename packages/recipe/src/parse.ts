import { z } from 'zod';
import { RECIPE_SCHEMA, type CompactRecipe, type Recipe } from './types';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'must be 64 lowercase hex characters');
const seed = z.number().int().min(0).max(2 ** 32 - 1);
const shared = {
  schema: z.literal(RECIPE_SCHEMA),
  kind: z.enum(['photo', 'clip', 'film']),
  task: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
  backend: z.string().min(1),
  seed,
  preset: z.object({ id: z.string().min(1), remix: z.boolean(), sha256 }).optional(),
  post: z.array(z.string()),
};

type RequestShape = { route: string; body: Record<string, unknown>; files: { field: string; sha256: string | null }[]; then?: RequestShape[] };
const RequestSchema: z.ZodType<RequestShape> = z.lazy(() =>
  z.object({
    route: z.string().startsWith('/api/'),
    body: z.record(z.string(), z.unknown()),
    files: z.array(z.object({ field: z.string().min(1), sha256: sha256.nullable() })),
    then: z.array(RequestSchema).optional(),
  }),
);
const Slot = z.object({ node: z.string(), field: z.string(), from: z.string().min(1), sha256: sha256.nullable() });
const Workflow = z.record(z.string(), z.object({ class_type: z.string().min(1), inputs: z.record(z.string(), z.unknown()), _meta: z.unknown().optional() }));
const Stack = z.object({
  montagio: z.object({ version: z.string(), commit: z.string().nullable() }),
  comfyui: z.object({ tag: z.string(), commit: z.string() }),
});

const FullSchema = z.object({
  ...shared,
  presetYaml: z.string().optional(),
  reprise: z.record(z.string(), z.unknown()).optional(),
  request: RequestSchema.optional(),
  steps: z.array(
    z.object({
      name: z.string().min(1),
      workflow: Workflow,
      workflowSha256: sha256,
      inputs: z.array(Slot),
      settings: z.object({
        width: z.number().optional(),
        height: z.number().optional(),
        frames: z.number().optional(),
        fps: z.number().optional(),
        steps: z.number().optional(),
        cfg: z.number().optional(),
        seeds: z.array(z.number()),
        texts: z.array(z.string()),
      }),
    }),
  ),
  models: z.array(z.object({ id: z.string(), name: z.string(), license: z.string() })),
  weights: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      sha256: sha256.optional(),
      git_sha1: z.string().optional(),
      size: z.number().optional(),
      license: z.string(),
      source: z.string(),
      url: z.string(),
      modelId: z.string().optional(),
    }),
  ),
  stack: Stack.extend({
    proxy: z.string(),
    nodes: z.array(z.object({ name: z.string(), version: z.string().optional(), repo: z.string().optional(), commit: z.string().optional() })),
  }),
  output: z.object({ sha256 }).optional(),
});

const CompactSchema = z.object({
  ...shared,
  compact: z.literal(true),
  truncated: z.literal(true).optional(),
  request: RequestSchema.optional(),
  steps: z.array(z.object({ name: z.string().min(1), workflowSha256: sha256, inputs: z.array(z.object({ from: z.string().min(1), sha256: sha256.nullable() })) })),
  weights: z.array(z.object({ id: z.string(), sha256: sha256.optional() })),
  stack: Stack,
});

/** A recipe read from a file, a tag or a request: full or compact, or the list of what is wrong with it. */
export function parseRecipe(raw: unknown): { ok: true; recipe: Recipe | CompactRecipe } | { ok: false; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['a recipe is a JSON object'] };
  const schema = (raw as { compact?: unknown }).compact === true ? CompactSchema : FullSchema;
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, recipe: result.data as Recipe | CompactRecipe };
  return { ok: false, problems: result.error.issues.map((issue) => `${issue.path.join('.') || 'recipe'}: ${issue.message}`) };
}
