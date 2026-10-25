import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTION_FONTS } from '@montagio/captions';
import { getEnv } from './env';

/** The embedded caption fonts (OFL), served to the Studio as /fonts/captions/ and read by FFmpeg from here. */
export const captionFontsDir = () => join(getEnv().root, 'apps', 'web', 'public', 'fonts', 'captions');

/** Copy caption fonts (all of them by default) into `dir`/fonts, where libass looks for them by name (FFmpeg runs in `dir`). */
export async function copyCaptionFonts(dir: string, files: readonly string[] = CAPTION_FONTS.map((font) => font.file)): Promise<void> {
  await mkdir(join(dir, 'fonts'), { recursive: true });
  await Promise.all(files.map((file) => copyFile(join(captionFontsDir(), file), join(dir, 'fonts', file))));
}

const holder = globalThis as typeof globalThis & { __montagioCaptionFonts?: Map<string, Promise<string>> };
const digests = (holder.__montagioCaptionFonts ??= new Map());

/** The first 12 hex digits of the sha256 of the fonts' sha256s, in their order: what a recipe notes of the fonts it drew with. */
export function captionFontsDigest(): Promise<string> {
  const dir = captionFontsDir();
  let digest = digests.get(dir);
  if (!digest) {
    digest = Promise.all(CAPTION_FONTS.map(async (font) => createHash('sha256').update(await readFile(join(dir, font.file))).digest('hex'))).then((hashes) =>
      createHash('sha256').update(hashes.join('\n')).digest('hex').slice(0, 12),
    );
    digests.set(dir, digest);
    digest.catch(() => digests.delete(dir));
  }
  return digest;
}
