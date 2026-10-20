import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnv } from './env';
import { JobError } from './errors';
import type { UploadMeta } from './uploads';

/** Lower case, no accents, one space between words: "Zinédine  ZIDANE" reads "zinedine zidane". */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The first listed name `text` contains as whole words, or null. */
export function findBlockedName(text: string, names: readonly string[]): string | null {
  const haystack = ` ${normalizeForMatch(text)} `;
  return names.find((name) => haystack.includes(` ${normalizeForMatch(name)} `)) ?? null;
}

// The list of registry/blocked-names.txt, read once per repository root.
const holder = globalThis as typeof globalThis & { __montagioBlockedNames?: { root: string; names: Promise<readonly string[]> } };

export function blockedNames(): Promise<readonly string[]> {
  const { root } = getEnv();
  if (holder.__montagioBlockedNames?.root !== root) {
    const names = readFile(join(root, 'registry', 'blocked-names.txt'), 'utf8').then((text) =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    );
    holder.__montagioBlockedNames = { root, names };
  }
  return holder.__montagioBlockedNames!.names;
}

/** Refuse with 400 blocked-name a text that names a listed person; the name goes to the log only. */
export async function assertNoBlockedName(...texts: (string | undefined)[]): Promise<void> {
  const names = await blockedNames();
  for (const text of texts) {
    if (!text) continue;
    const name = findBlockedName(text, names);
    if (name) {
      console.warn(`[montagio] a request names a listed person (${name}): refused`);
      throw new JobError('blocked-name');
    }
  }
}

/**
 * A photo that is, or derives from, an imported one may show a real person: an edit, an
 * effect, a hook or an avatar on it needs the box "I am the person in this photo, or I have
 * their consent" ticked (`consent: true`, nothing else counts).
 */
export function assertConsent(meta: UploadMeta, consent: unknown): void {
  if (meta.personal && consent !== true) throw new JobError('consent-required');
}
