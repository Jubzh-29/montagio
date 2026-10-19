import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * The start image of a smoke run, as smoke.jsonl records it: the showcase's
 * ingest keeps a clip only if it was rendered from the exact sample photo.
 */
export async function imageFingerprint(path: string): Promise<{ image: string; image_sha256: string }> {
  return { image: basename(path), image_sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}
