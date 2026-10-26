import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * The showcase manifest (demo-assets/showcase/manifest.yaml) says which sample
 * photos the free demo link offers and which clips were really rendered for
 * them. A preset × sample pair without a clip entry gets a placeholder.
 */
export const MANIFEST_SCHEMA = 'montagio/showcase@0.1';
/** The showcase folder, relative to the repository root. */
export const SHOWCASE_DIR = 'demo-assets/showcase';

const kebabId = z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case (a-z, 0-9, -)');
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hexadecimal characters');

const SampleSchema = z
  .object({
    id: kebabId,
    file: z.string().regex(/^samples\/[a-z0-9-]+\.(png|jpg|webp)$/, 'must be samples/<name>.png, .jpg or .webp'),
    aspect: z.enum(['16:9', '9:16', '1:1']),
    title: z.object({ en: z.string().min(1).max(60), fr: z.string().min(1).max(60) }).strict(),
    status: z.enum(['placeholder', 'final']),
    credit: z.string().min(1).max(400),
    /** The text Z-Image-Turbo made the photo from: the showcase's Text to image offers it. */
    prompt: z.string().min(1).max(500).optional(),
  })
  .strict();

const seed = z.number().int().min(0).max(2 ** 32 - 1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, YYYY-MM-DD');

/**
 * The 1080p pass of a clip: SeedVR2 restored the 480p render, and the file of the showcase is
 * its output. `input` is the name the run loaded the 480p clip under (it is in the workflow),
 * `source_sha256` the sha256 of that clip.
 */
const hdFields = {
  model: kebabId,
  seed,
  input: z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/, 'must be the file name of an .mp4 clip'),
  source_sha256: sha256,
  workflow_sha256: sha256,
  rendered_at: date,
};
const HdSchema = z.object(hdFields).strict();

const ClipSchema = z
  .object({
    preset: kebabId,
    sample: kebabId,
    seed,
    /** The description of the photo the model got before the preset's text, when it is not the sample's prompt. */
    description: z.string().min(1).max(500).optional(),
    /** The negative prompt the model got instead of the preset's (smoke --negative). */
    negative: z.string().min(1).max(500).optional(),
    sha256,
    /** The sample photo the clip was rendered from: a photo replaced afterwards is caught. */
    image_sha256: sha256,
    workflow_sha256: sha256,
    rendered_at: date,
    hd: HdSchema.optional(),
  })
  .strict();

/** An effect or a hook rendered on a sample photo in a GPU session, tied like a clip to its seed and workflow. */
const exampleFields = {
  sample: kebabId,
  seed,
  sha256,
  image_sha256: sha256,
  workflow_sha256: sha256,
  rendered_at: date,
  hd: HdSchema.optional(),
};
const EffectExampleSchema = z.object({ effect: kebabId, ...exampleFields }).strict();
const HookExampleSchema = z.object({ hook: kebabId, ...exampleFields }).strict();

/**
 * The functions a feature example shows, beside the camera clips, the effects and the hooks: the
 * avatar, its translation and its captions, the motion transfer, Restyle, the object swap and the
 * trend remix. Each was rendered by smoke.ts from the showcase's own pictures and clips.
 */
export const FEATURE_KINDS = ['avatar', 'translate', 'captions', 'motion', 'restyle', 'swap', 'remix'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];
/** The kinds whose example speaks: its file keeps its sound. */
export const SPEAKING_FEATURES: ReadonlySet<FeatureKind> = new Set(['avatar', 'translate', 'captions']);
/** Every extension job of the app renders at 16 fps; RIFE doubles it in a smooth HD pass. */
export const FEATURE_FPS = 16;
export const SMOOTH_FPS = 32;

/** What a feature example started from, kept beside it: the photo it read, the clip it followed, the frame it restyled. */
const FeatureInputSchema = z
  .object({
    role: z.enum(['photo', 'clip', 'frame']),
    file: z.string().regex(/^features\/inputs\/[a-z0-9-]+\.(png|jpg|mp4)$/, 'must be features/inputs/<name>.png, .jpg or .mp4'),
    sha256,
  })
  .strict();

/** One job of an example's chain, in order (the voice, then the avatar): its model, and the workflow it ran. */
const FeatureStepSchema = z.object({ model: kebabId, workflow_sha256: sha256 }).strict();

const FeatureSchema = z
  .object({
    id: kebabId,
    feature: z.enum(FEATURE_KINDS),
    aspect: z.enum(['16:9', '9:16']),
    seed,
    /** The words said, the new look, the new object or the character, as the job got them. */
    text: z.string().min(1).max(500).optional(),
    /** The language a translation speaks, or captions are written in. */
    language: z.string().regex(/^[a-z]{2}$/).optional(),
    /** The starting face of the bank (apps/web/src/lib/character-bank.ts) the example was made with. */
    face: kebabId.optional(),
    /** The example it was made from: the avatar a translation says again, or whose captions it burns in. */
    from: kebabId.optional(),
    /** Captions: the style burned in. */
    style: kebabId.optional(),
    /** A trend remix: the post Gemma wrote for it. */
    post: z.object({ caption: z.string().max(600), hashtags: z.array(z.string().min(1).max(60)).max(12) }).strict().optional(),
    inputs: z.array(FeatureInputSchema).max(4).default([]),
    steps: z.array(FeatureStepSchema).min(1).max(8),
    sha256,
    rendered_at: date,
    /** Its 1080p pass; `smooth`: RIFE put a frame between each two (32 fps). */
    hd: z.object({ ...hdFields, smooth: z.boolean() }).strict().optional(),
  })
  .strict();

/** A render kept out of the showcase for what it shows: ingest skips it, and it cannot be listed. */
const withheldFields = { sample: kebabId, reason: z.string().min(1).max(200) };
const WithheldSchema = z.union([
  z.object({ preset: kebabId, ...withheldFields }).strict(),
  z.object({ effect: kebabId, ...withheldFields }).strict(),
  z.object({ hook: kebabId, ...withheldFields }).strict(),
]);

const ManifestSchema = z
  .object({
    schema: z.literal(MANIFEST_SCHEMA),
    model: kebabId,
    samples: z.array(SampleSchema).min(1),
    clips: z.array(ClipSchema).default([]),
    effects: z.array(EffectExampleSchema).default([]),
    hooks: z.array(HookExampleSchema).default([]),
    features: z.array(FeatureSchema).default([]),
    withheld: z.array(WithheldSchema).default([]),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type SampleEntry = Manifest['samples'][number];
export type ClipEntry = Manifest['clips'][number];
export type EffectExample = Manifest['effects'][number];
export type HookExample = Manifest['hooks'][number];
export type HdPass = NonNullable<ClipEntry['hd']>;
export type FeatureEntry = Manifest['features'][number];
export type FeatureHdPass = NonNullable<FeatureEntry['hd']>;
export type WithheldEntry = Manifest['withheld'][number];

/** The section a render belongs to, and its preset, effect or hook. */
export type RenderKind = 'clip' | 'effect' | 'hook';
export const withheldKind = (entry: WithheldEntry): { kind: RenderKind; id: string } =>
  'preset' in entry ? { kind: 'clip', id: entry.preset } : 'effect' in entry ? { kind: 'effect', id: entry.effect } : { kind: 'hook', id: entry.hook };

/** The reason a render is withheld from the showcase, or undefined when it is not. */
export function withheldReason(manifest: Pick<Manifest, 'withheld'>, kind: RenderKind, id: string, sample: string): string | undefined {
  return manifest.withheld.find((entry) => {
    const what = withheldKind(entry);
    return what.kind === kind && what.id === id && entry.sample === sample;
  })?.reason;
}

export class ManifestError extends Error {
  override name = 'ManifestError';
  constructor(readonly problems: string[]) {
    super(`showcase manifest has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  }
}

/** Parse and cross-check a manifest; every problem is a "<path>: <message>" line. */
export function parseManifest(text: string, source: string): Manifest {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new ManifestError([`${source}: invalid YAML (${(error as Error).message})`]);
  }
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ManifestError(
      result.error.issues.map((issue) => {
        const keys = 'keys' in issue && Array.isArray(issue.keys) ? `.${issue.keys.join(',')}` : '';
        return `${issue.path.join('.') || '(root)'}${keys}: ${issue.message}`;
      }),
    );
  }
  const manifest = result.data;
  const problems: string[] = [];
  const sampleIds = new Set<string>();
  manifest.samples.forEach((sample, index) => {
    if (sampleIds.has(sample.id)) problems.push(`samples.${index}.id: duplicate sample id "${sample.id}"`);
    sampleIds.add(sample.id);
  });
  const pairs = new Set<string>();
  manifest.clips.forEach((clip, index) => {
    const pair = `${clip.preset} × ${clip.sample}`;
    if (pairs.has(pair)) problems.push(`clips.${index}: duplicate clip ${pair}`);
    pairs.add(pair);
    if (!sampleIds.has(clip.sample)) problems.push(`clips.${index}.sample: unknown sample "${clip.sample}"`);
  });
  for (const [section, entries] of [['effects', manifest.effects.map((entry) => ({ id: entry.effect, sample: entry.sample }))], ['hooks', manifest.hooks.map((entry) => ({ id: entry.hook, sample: entry.sample }))]] as const) {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const pair = `${entry.id} × ${entry.sample}`;
      if (seen.has(pair)) problems.push(`${section}.${index}: duplicate example ${pair}`);
      seen.add(pair);
      if (!sampleIds.has(entry.sample)) problems.push(`${section}.${index}.sample: unknown sample "${entry.sample}"`);
    });
  }
  const listed = {
    clip: manifest.clips.map((entry) => `${entry.preset} × ${entry.sample}`),
    effect: manifest.effects.map((entry) => `${entry.effect} × ${entry.sample}`),
    hook: manifest.hooks.map((entry) => `${entry.hook} × ${entry.sample}`),
  };
  const section = { clip: 'clips', effect: 'effects', hook: 'hooks' } as const;
  manifest.withheld.forEach((entry, index) => {
    const { kind, id } = withheldKind(entry);
    if (!sampleIds.has(entry.sample)) problems.push(`withheld.${index}.sample: unknown sample "${entry.sample}"`);
    if (listed[kind].includes(`${id} × ${entry.sample}`)) problems.push(`withheld.${index}: ${id} × ${entry.sample} is withheld but listed in ${section[kind]}`);
  });
  const featureIds = new Set<string>();
  manifest.features.forEach((entry, index) => {
    if (featureIds.has(entry.id)) problems.push(`features.${index}.id: duplicate feature example "${entry.id}"`);
    featureIds.add(entry.id);
  });
  manifest.features.forEach((entry, index) => {
    // A translation says an avatar again, and captions burn into a talking clip: both name it.
    const needsFrom = entry.feature === 'translate' || entry.feature === 'captions';
    if (needsFrom && !entry.from) problems.push(`features.${index}.from: a ${entry.feature} example names the example it was made from`);
    if (entry.from && (entry.from === entry.id || !featureIds.has(entry.from))) problems.push(`features.${index}.from: unknown feature example "${entry.from}"`);
    if (needsFrom && !entry.language) problems.push(`features.${index}.language: a ${entry.feature} example says its language`);
    entry.inputs.forEach((input, at) => {
      if (!input.file.startsWith(`features/inputs/${entry.id}--`)) problems.push(`features.${index}.inputs.${at}.file: must be features/inputs/${entry.id}--<role>.<ext>`);
    });
  });
  if (problems.length > 0) throw new ManifestError(problems);
  return manifest;
}

export async function loadManifest(root: string): Promise<Manifest> {
  const path = join(root, SHOWCASE_DIR, 'manifest.yaml');
  return parseManifest(await readFile(path, 'utf8'), path);
}

/** Where each file of a pair lives, relative to the showcase folder (and to the published showcase). */
export const clipFile = (preset: string, sample: string) => `clips/${preset}--${sample}.mp4`;
export const verticalFile = (preset: string, sample: string) => `clips/${preset}--${sample}.9x16.mp4`;
export const workflowFile = (preset: string, sample: string) => `workflows/${preset}--${sample}.json`;
/** The recipe of a rendered clip (@montagio/recipe), shown by its Recipe panel and saved from it. */
export const recipeFile = (preset: string, sample: string) => `recipes/${preset}--${sample}.json`;
export const effectFile = (effect: string, sample: string) => `effects/${effect}--${sample}.mp4`;
export const hookFile = (hook: string, sample: string) => `hooks/${hook}--${sample}.mp4`;
export const exampleWorkflowFile = (kind: 'effect' | 'hook', id: string, sample: string) => `workflows/${kind}-${id}--${sample}.json`;
export const featureFile = (id: string) => `features/${id}.mp4`;
export const featureInputFile = (id: string, role: string, ext: string) => `features/inputs/${id}--${role}.${ext}`;
/** The workflow of the step at `index` (from 0) of a feature example, as smoke.ts wrote it. */
export const featureWorkflowFile = (id: string, index: number, model: string) => `workflows/feature-${id}--${index + 1}-${model}.json`;
/** The workflow of a feature example's HD pass, compiled again by prepare: "Open in ComfyUI" hands it out. */
export const featureHdWorkflowFile = (id: string) => `workflows/feature-${id}--hd.json`;
