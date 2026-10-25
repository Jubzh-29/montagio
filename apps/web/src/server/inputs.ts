import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { InputSlot } from '@montagio/recipe';
import { speechPath, uploadPath, videoPath, voicePath } from './tasks/files';

/** sha256 of a file, read as a stream (a reference clip is up to 50 MB); null when it cannot be read. */
export function fileSha256(path: string): Promise<string | null> {
  return new Promise((done) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', () => done(null));
  });
}

/** Fields of a job's inputs that name a file the app holds, and where that file is. */
const FILE_FIELDS: Record<string, (ref: string) => string | null> = {
  imageRef: uploadPath,
  image2Ref: uploadPath,
  productRef: uploadPath,
  characterRef: uploadPath,
  overlayRef: uploadPath,
  maskRef: uploadPath,
  videoRef: videoPath,
  voiceRef: voicePath,
  speechRef: speechPath,
  audioRef: speechPath,
};

/**
 * The files a job's inputs name: `from` is the field ("imageRef", "compose.place"…). `more` resolves
 * fields only the caller knows how to read (an HD job's clipUrl).
 */
export function inputFiles(inputs: Record<string, unknown>, more: Record<string, (value: string) => string | null> = {}): { from: string; path: string }[] {
  const files: { from: string; path: string }[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    const path = typeof value === 'string' ? (FILE_FIELDS[key] ?? more[key])?.(value) : undefined;
    if (path) files.push({ from: key, path });
    if (key === 'compose' && value && typeof value === 'object') {
      for (const [role, ref] of Object.entries(value)) if (typeof ref === 'string') files.push({ from: `compose.${role}`, path: uploadPath(ref) });
    }
  }
  return files;
}

/**
 * The input slots of a step: each file the backend uploads, by sha256, with where it came from among
 * `known` (the request's files, the earlier steps' outputs); "derived" for a file the app made on the way.
 */
export async function slotsOf(files: readonly { node: string; field: string; path: string }[], known: readonly { from: string; path: string }[]): Promise<InputSlot[]> {
  return Promise.all(
    files.map(async (file) => ({
      node: file.node,
      field: file.field,
      from: known.find((entry) => resolve(entry.path) === resolve(file.path))?.from ?? 'derived',
      sha256: await fileSha256(file.path),
    })),
  );
}

/** A seed the client sends back to render the same thing again: a whole number from 0 to 2^32 - 1, else none. */
export function replaySeed(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** 32 ? value : undefined;
}
