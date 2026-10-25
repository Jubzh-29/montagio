// The still a gallery tile shows while its preview clip loads: the clip's first frame, a small
// JPEG beside it (presets/**/previews/<name>.jpg) that says it is AI-generated. Run it after
// adding a preview (`npm run previews:posters`); an existing poster is kept, --force remakes all.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_METADATA, posterFrame } from '@montagio/sequence';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const force = process.argv.includes('--force');
/** 480 px wide: a tile's size on a large screen, about 20 KB a poster. */
const POSTER_WIDTH = 480;

let made = 0;
for (const folder of ['presets/previews', 'presets/effects/previews', 'presets/transitions/previews', 'presets/extensions/previews', 'presets/motions/previews']) {
  const dir = join(root, folder);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.mp4'))) {
    const poster = join(dir, name.replace(/\.mp4$/, '.jpg'));
    if (existsSync(poster) && !force) continue;
    await posterFrame(join(dir, name), poster, { width: POSTER_WIDTH, comment: AI_METADATA.comment });
    made += 1;
  }
}
console.log(`preview posters: ${made} made`);
