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
  })
  .strict();

const ClipSchema = z
  .object({
    preset: kebabId,
    sample: kebabId,
    seed: z.number().int().min(0).max(2 ** 32 - 1),
    sha256,
    /** The sample photo the clip was rendered from: a photo replaced afterwards is caught. */
    image_sha256: sha256,
    workflow_sha256: sha256,
    rendered_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, YYYY-MM-DD'),
  })
  .strict();

const ManifestSchema = z
  .object({
    schema: z.literal(MANIFEST_SCHEMA),
    model: kebabId,
    samples: z.array(SampleSchema).min(1),
    clips: z.array(ClipSchema).default([]),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type SampleEntry = Manifest['samples'][number];
export type ClipEntry = Manifest['clips'][number];

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
