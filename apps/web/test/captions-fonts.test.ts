import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTION_FONTS } from '@montagio/captions';

const DIR = join(__dirname, '..', 'public', 'fonts', 'captions');

/** The characters a TTF maps to a glyph, read from its cmap table (formats 4 and 12, the Windows Unicode subtables). */
function covered(font: Buffer): (char: string) => boolean {
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16;
    if (font.toString('latin1', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
  }
  if (cmap < 0) throw new Error('no cmap table');
  const subtables = new Map<string, number>();
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    subtables.set(`${font.readUInt16BE(record)}/${font.readUInt16BE(record + 2)}`, cmap + font.readUInt32BE(record + 4));
  }
  const full = subtables.get('3/10');
  if (full !== undefined && font.readUInt16BE(full) === 12) {
    const groups = Array.from({ length: font.readUInt32BE(full + 12) }, (_, n) => [font.readUInt32BE(full + 16 + n * 12), font.readUInt32BE(full + 20 + n * 12)] as const);
    return (char) => groups.some(([start, end]) => char.codePointAt(0)! >= start && char.codePointAt(0)! <= end);
  }
  const bmp = subtables.get('3/1') ?? subtables.get('0/3');
  if (bmp === undefined || font.readUInt16BE(bmp) !== 4) throw new Error('no Unicode cmap of format 4 or 12');
  const segments = font.readUInt16BE(bmp + 6) / 2;
  const ends = bmp + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const offsets = deltas + segments * 2;
  return (char) => {
    const code = char.codePointAt(0)!;
    for (let n = 0; n < segments; n++) {
      if (code > font.readUInt16BE(ends + n * 2)) continue;
      const start = font.readUInt16BE(starts + n * 2);
      if (code < start) return false;
      const delta = font.readInt16BE(deltas + n * 2);
      const offset = font.readUInt16BE(offsets + n * 2);
      if (offset === 0) return ((code + delta) & 0xffff) !== 0;
      const glyph = font.readUInt16BE(offsets + n * 2 + offset + (code - start) * 2);
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    }
    return false;
  };
}

// The letters of the 22 caption languages (the fontTools check of 2026-10-25), and the punctuation of a caption.
const LETTERS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  `.,;:!?'"-()%&/…–—“”‘’«»¿¡`,
  'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ', // fr
  'áíóúñÁÍÓÚÑ', // es
  'äöüßÄÖÜ', // de
  'ìòÌÒ', // it
  'ãõÃÕ', // pt
  'ŀĿ·', // ca (l·l)
  'ąćęłńśźżĄĆĘŁŃŚŹŻ', // pl
  'ăîșțĂÎȘȚşţŞŢ', // ro, with the cedilla forms Whisper may write
  'åøÅØ', // sv, da, no, fi
  'čďěňřšťůýžČĎĚŇŘŠŤŮÝŽĺľŕĹĽŔ', // cs, sk
  'đĐ', // hr, sl
  'őűŐŰ', // hu
  'ğışİĞŞ', // tr
].join('');

describe('caption fonts', () => {
  it.each(CAPTION_FONTS.map((font) => [font.file]))('%s is the file the README names, licensed beside it', async (file) => {
    const readme = await readFile(join(DIR, 'README.md'), 'utf8');
    const row = readme.split('\n').find((line) => line.includes(`\`${file}\``));
    expect(row, `README row for ${file}`).toBeDefined();
    const sha = createHash('sha256').update(await readFile(join(DIR, file))).digest('hex');
    expect(row).toContain(sha);
    expect(row).toMatch(/OFL-1\.1/);
    const licence = row!.match(/`(OFL-[A-Za-z]+\.txt)`/)?.[1];
    expect(licence).toBeDefined();
    expect(await readFile(join(DIR, licence!), 'utf8')).toContain('SIL Open Font License, Version 1.1');
  });

  it.each(CAPTION_FONTS.map((font) => [font.file]))('%s has every letter of the caption languages', async (file) => {
    const has = covered(await readFile(join(DIR, file)));
    const missing = [...LETTERS].filter((char) => !has(char));
    expect(missing.join('')).toBe('');
  });
});
