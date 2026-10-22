import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');

test('every gallery preview has its still beside it, which says it is AI-generated', () => {
  const clips = ['presets/previews', 'presets/effects/previews', 'presets/transitions/previews'].flatMap((folder) =>
    readdirSync(join(root, folder))
      .filter((file) => file.endsWith('.mp4'))
      .map((file) => join(root, folder, file)),
  );
  expect(clips.length).toBeGreaterThan(0);
  for (const clip of clips) {
    // npm run previews:posters makes the missing ones.
    const poster = readFileSync(clip.replace(/\.mp4$/, '.jpg'));
    expect(poster.subarray(6, 6 + 'AI-generated'.length).toString('utf8')).toBe('AI-generated');
  }
});
