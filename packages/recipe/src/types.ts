/** The recipe of a result: what made it, exactly, and how to make it again. */
export const RECIPE_SCHEMA = 'montagio/recipe@1';

/** A ComfyUI workflow in API format (the shape @montagio/presets compiles). */
export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

/**
 * One input file of a step, by its sha256: never the file, never its path. `from` says where it came from:
 * a field of the request ("imageRef", "image2Ref", "videoRef", "compose.place"…), "step:<n>" (the output of
 * step n), "frame:<n>" (the last frame of step n) or "derived" (a file the app made on the way).
 */
export type InputSlot = { node: string; field: string; from: string; sha256: string | null };

/** What a step's workflow says about the render, read from its nodes. */
export type StepSettings = {
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  steps?: number;
  cfg?: number;
  seeds: number[];
  texts: string[];
};

/** One job ComfyUI ran: its workflow with each input file replaced by "<from>", and that workflow's sha256. */
export type RecipeStep = { name: string; workflow: ApiWorkflow; workflowSha256: string; inputs: InputSlot[]; settings: StepSettings };

/**
 * The request that makes the result again on a Montagio app: its route and body, the same seed included,
 * and the body fields that take a file (an upload's ref). `then` follows on what it made (`:parent`).
 */
export type RecipeRequest = {
  route: string;
  body: Record<string, unknown>;
  files: { field: string; sha256: string | null }[];
  then?: RecipeRequest[];
};

export type RecipeWeight = {
  id: string;
  file: string;
  sha256?: string;
  git_sha1?: string;
  size?: number;
  license: string;
  source: string;
  url: string;
  /** The model of the registry that brings this file (its row on the Open Stack page). */
  modelId?: string;
};

export type RecipeModel = { id: string; name: string; license: string };

export type RecipeStack = {
  montagio: { version: string; commit: string | null };
  comfyui: { tag: string; commit: string };
  proxy: string;
  nodes: { name: string; version?: string; repo?: string; commit?: string }[];
};

export type Recipe = {
  schema: typeof RECIPE_SCHEMA;
  kind: 'photo' | 'clip' | 'film';
  task: string;
  name: string;
  createdAt: string;
  /** "local" (ComfyUI ran it) or "demo" (no model ran: this is the recipe that would render it). */
  backend: string;
  seed: number;
  preset?: { id: string; remix: boolean; sha256: string };
  presetYaml?: string;
  /** The Studio's choices, without any photo of the machine. */
  reprise?: Record<string, unknown>;
  request?: RecipeRequest;
  steps: RecipeStep[];
  /** What FFmpeg did after ComfyUI: "tag", "last-frame", "concat", "vertical", "mix". */
  post: string[];
  models: RecipeModel[];
  weights: RecipeWeight[];
  stack: RecipeStack;
  /** The delivered file, when the recipe is read next to it. */
  output?: { sha256: string };
};

/** The recipe a file carries in its tags: hashes only, no workflow body. */
export type CompactRecipe = Pick<Recipe, 'schema' | 'kind' | 'task' | 'name' | 'createdAt' | 'backend' | 'seed' | 'preset' | 'request' | 'post'> & {
  compact: true;
  /** Something was left out to stay under the size cap: the full recipe has it. */
  truncated?: true;
  steps: { name: string; workflowSha256: string; inputs: { from: string; sha256: string | null }[] }[];
  weights: { id: string; sha256?: string }[];
  stack: Pick<RecipeStack, 'montagio' | 'comfyui'>;
};

/** A recipe before its workflows are normalized and hashed and its weights looked up. */
export type RecipeDraft = Omit<Recipe, 'schema' | 'steps' | 'models' | 'weights' | 'stack' | 'output'> & {
  steps: { name: string; workflow: ApiWorkflow; inputs: InputSlot[] }[];
  /** The models that ran, as the records name them: a weight several models declare goes to one of these first. */
  modelIds?: string[];
};

/** An entry of registry/models.lock.yaml (the registry's LockEntry, without depending on it). */
export type LockLike = {
  id: string;
  file: string;
  url: string;
  sha256?: string;
  git_sha1?: string;
  size?: number;
  license: string;
  source: string;
  folder?: string;
};

export type ModelLike = { id: string; name: string; license: string; weights: readonly string[] };

export type RecipeContext = { lock: Iterable<LockLike>; models: Iterable<ModelLike>; stack: RecipeStack };
