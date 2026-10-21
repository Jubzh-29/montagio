import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Aspect } from '@montagio/presets';

/** One image of smoke --t2i: its name (the output file's), its aspect and its text. */
export type ImagePrompt = { name: string; aspect: Aspect; text: string };

/**
 * The images of smoke --t2i, "NAME=TEXT" or "NAME@9:16=TEXT" (16:9 when no aspect is given):
 * the test photos of a GPU session, made by the app's text-to-image model.
 */
export function imagePrompts(values: readonly string[]): ImagePrompt[] {
  const names = new Set<string>();
  return values.map((value) => {
    const match = /^([a-z0-9][a-z0-9_-]*)(?:@(16:9|9:16|1:1))?=([\s\S]+)$/.exec(value);
    const text = match?.[3]?.trim();
    if (!match || !text) throw new Error(`--t2i "${value}": write NAME=TEXT or NAME@9:16=TEXT (name in lowercase letters, digits, - or _)`);
    const name = match[1]!;
    if (names.has(name)) throw new Error(`--t2i: two images named "${name}"`);
    names.add(name);
    return { name, aspect: (match[2] as Aspect | undefined) ?? '16:9', text };
  });
}

/**
 * The start image of a smoke run, as smoke.jsonl records it: the showcase's
 * ingest keeps a clip only if it was rendered from the exact sample photo.
 */
export async function imageFingerprint(path: string): Promise<{ image: string; image_sha256: string }> {
  return { image: basename(path), image_sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}
