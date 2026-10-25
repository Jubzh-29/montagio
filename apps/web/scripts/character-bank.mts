// The bank of starting faces (src/lib/character-bank.ts), from the GPU and back:
//   npx tsx scripts/character-bank.mts jobs [id…]           the smoke's --t2i arguments, one image per face
//   npx tsx scripts/character-bank.mts ingest <run> [id…]   the faces a smoke run rendered: each checked
//     against the workflow the Studio compiles for it, then a 720 px JPEG and its recipe in
//     demo-assets/faces/, a 240x320 thumbnail in public/characters/faces/, and a review sheet in <run>.
// Run from apps/web. A face joins the tabs only once its id is in FACES_WITH_PICTURE.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLibrary } from '@montagio/presets';
import { readStack, workflowSha256, type ApiWorkflow } from '@montagio/recipe';
import { AI_METADATA, posterFrame } from '@montagio/sequence';
import { CHARACTER_BANK, facePrompt, type BankFace } from '../src/lib/character-bank';
import { FACE_ASPECT, faceRecipe, faceWorkflow } from '../src/server/character-bank';
import { T2I_MODEL } from '../src/server/tasks/t2i';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ffmpeg = process.env.MONTAGIO_FFMPEG ?? 'ffmpeg';
const run = promisify(execFile);
const [command, ...rest] = process.argv.slice(2);

function pick(ids: readonly string[]): BankFace[] {
  if (ids.length === 0) return [...CHARACTER_BANK];
  return ids.map((id) => {
    const face = CHARACTER_BANK.find((entry) => entry.id === id);
    if (!face) throw new Error(`no face "${id}" in the bank`);
    return face;
  });
}

if (command === 'jobs') {
  // One smoke job: the text-to-image model stays loaded from one face to the next.
  console.log(pick(rest).map((face) => `--t2i "${face.id}@${FACE_ASPECT}#${face.seed}=${facePrompt(face)}"`).join(' '));
} else if (command === 'ingest' && rest[0]) {
  const [runDir, ...ids] = rest as [string, ...string[]];
  const [lib, stack] = await Promise.all([loadLibrary(root), readStack(root)]);
  const records = readFileSync(join(runDir, 'smoke.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { job: string; status: string; at: string });
  const clips = readdirSync(join(runDir, 'clips'));
  const faces = join(root, 'demo-assets', 'faces');
  const thumbs = join(root, 'apps', 'web', 'public', 'characters', 'faces');
  await mkdir(faces, { recursive: true });
  await mkdir(thumbs, { recursive: true });
  const done: string[] = [];
  for (const face of pick(ids)) {
    const record = records.findLast((entry) => entry.job === `t2i:${face.id}`);
    const png = clips.find((file) => file.endsWith(`__t2i-${face.id}__${T2I_MODEL}__r1.png`));
    if (record?.status !== 'succeeded' || !png) {
      console.log(`- ${face.id}: not rendered in this run`);
      continue;
    }
    // The recipe must be the render's: the workflow the GPU ran is the one the Studio compiles for this face.
    const ran = JSON.parse(await readFile(join(runDir, 'workflows', `t2i-${face.id}__${T2I_MODEL}.api.json`), 'utf8')) as ApiWorkflow;
    if (workflowSha256(ran) !== workflowSha256(faceWorkflow(lib, face))) throw new Error(`${face.id}: the workflow that ran is not the one the Studio compiles`);
    const jpeg = join(faces, `${face.id}.jpg`);
    await posterFrame(join(runDir, 'clips', png), jpeg, { width: 720, comment: AI_METADATA.comment });
    // The thumbnail: the top of the full-length portrait, head to knees, in 3:4 (a centred crop cut tall heads off).
    await run(ffmpeg, ['-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-i', jpeg, '-vf', 'scale=240:-2,crop=240:320:0:0','-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', '-map_metadata', '-1', join(thumbs, `${face.id}.webp`)], { windowsHide: true });
    const recipe = faceRecipe(lib, face, stack, record.at, await readFile(jpeg));
    await writeFile(join(faces, `${face.id}.recipe.json`), `${JSON.stringify(recipe, null, 2)}\n`);
    done.push(face.id);
    console.log(`✓ ${face.id}`);
  }
  if (done.length > 0) {
    // A sheet of the thumbnails, 7 to a row, to review them at a glance.
    const inputs = done.flatMap((id) => ['-i', join(thumbs, `${id}.webp`)]);
    const columns = Math.min(7, done.length);
    const rows = Math.ceil(done.length / columns);
    const layout = done.map((_, index) => `${(index % columns) * 240}_${Math.floor(index / columns) * 320}`).join('|');
    const filter = done.length === 1 ? '[0:v]null[out]' : `${done.map((_, index) => `[${index}:v]`).join('')}xstack=inputs=${done.length}:layout=${layout}:fill=white[out]`;
    await run(ffmpeg, ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', join(runDir, 'planche-banque.png')], { windowsHide: true });
    console.log(`${done.length} face(s), sheet ${join(runDir, 'planche-banque.png')} (${columns}×${rows})`);
  }
} else {
  console.error('usage: character-bank.mts jobs [id…] | ingest <run dir> [id…]');
  process.exitCode = 1;
}
