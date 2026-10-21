import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFingerprint, imagePrompts } from '../lib/image';

test('imagePrompts reads NAME=TEXT and NAME@ASPECT=TEXT, 16:9 by default', () => {
  expect(imagePrompts(['start=a harbor at golden hour, boats', 'character@9:16= a cartoon explorer, full body '])).toEqual([
    { name: 'start', aspect: '16:9', text: 'a harbor at golden hour, boats' },
    { name: 'character', aspect: '9:16', text: 'a cartoon explorer, full body' },
  ]);
  expect(imagePrompts(['a-b_2@1:1=x=y'])).toEqual([{ name: 'a-b_2', aspect: '1:1', text: 'x=y' }]);
});

test('imagePrompts refuses a missing name or text, an unknown aspect and a repeated name', () => {
  expect(() => imagePrompts(['a harbor at dusk'])).toThrow(/NAME=TEXT/);
  expect(() => imagePrompts(['start=  '])).toThrow(/NAME=TEXT/);
  expect(() => imagePrompts(['Start=a harbor'])).toThrow(/lowercase/);
  expect(() => imagePrompts(['start@4:3=a harbor'])).toThrow(/NAME@9:16=TEXT/);
  expect(() => imagePrompts(['start=a', 'start=b'])).toThrow(/two images named "start"/);
});

test('imageFingerprint gives the file name and its sha256', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-image-'));
  try {
    const path = join(dir, 'landscape-a.jpg');
    const bytes = Buffer.from('not really a jpeg, but bytes all the same');
    writeFileSync(path, bytes);
    expect(await imageFingerprint(path)).toEqual({
      image: 'landscape-a.jpg',
      image_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
