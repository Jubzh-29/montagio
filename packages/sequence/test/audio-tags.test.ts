import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAudio, readTags, tagAudio } from '../src/index';

const flac = fileURLToPath(new URL('../../../demo-assets/audio/_default.flac', import.meta.url));

test('tagAudio copies a FLAC with the AI-generated mention, without re-encoding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-audio-tags-'));
  try {
    const out = join(dir, 'out.flac');
    await tagAudio(flac, out);
    const tags = Object.fromEntries(Object.entries(await readTags(out)).map(([key, value]) => [key.toLowerCase(), value]));
    expect(tags.comment).toBe('AI-generated');
    expect(await probeAudio(out)).toMatchObject({ codec: 'flac', sampleRate: 24000, channels: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
