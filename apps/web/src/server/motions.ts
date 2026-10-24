import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { LibraryMotionSummary } from '@/lib/api-types';
import { getEnv } from './env';
import { presetPosterUrl, presetPreviewUrl } from './gallery';

/** One reference motion of presets/motions/library.yaml: made by Montagio from a fictional character. */
export type LibraryMotion = { id: string; name: string; description: string; name_fr?: string; description_fr?: string; duration_s: number };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The library's motions, in the manifest's order; an entry that is malformed is left out. */
export async function libraryMotions(): Promise<LibraryMotion[]> {
  let raw: unknown;
  try {
    raw = parse(await readFile(join(getEnv().root, 'presets', 'motions', 'library.yaml'), 'utf8'));
  } catch {
    return [];
  }
  const motions = (raw as { motions?: unknown }).motions;
  if (!Array.isArray(motions)) return [];
  return motions.flatMap((entry): LibraryMotion[] => {
    const { id, name, description, name_fr, description_fr, duration_s } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || typeof name !== 'string' || typeof description !== 'string' || typeof duration_s !== 'number') return [];
    return [{ id, name, description, duration_s, ...(typeof name_fr === 'string' ? { name_fr } : {}), ...(typeof description_fr === 'string' ? { description_fr } : {}) }];
  });
}

/** The clip of a library motion, under presets/motions/previews. */
export function libraryMotionPath(id: string): string {
  return join(getEnv().root, 'presets', 'motions', 'previews', `${id}.mp4`);
}

/** GET /api/motions: each motion whose clip is there, with its preview and poster. */
export async function libraryMotionSummaries(): Promise<LibraryMotionSummary[]> {
  const root = getEnv().root;
  const out: LibraryMotionSummary[] = [];
  for (const motion of await libraryMotions()) {
    const previewUrl = await presetPreviewUrl(root, `previews/${motion.id}.mp4`, 'motions');
    if (!previewUrl) continue;
    const posterUrl = await presetPosterUrl(root, `previews/${motion.id}.mp4`, 'motions');
    out.push({ ...motion, previewUrl, ...(posterUrl ? { posterUrl } : {}) });
  }
  return out;
}
