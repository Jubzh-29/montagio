import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFingerprint } from '../lib/image';

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
