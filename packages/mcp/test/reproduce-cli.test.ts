import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecipe } from '@montagio/recipe';
import { runCli } from '../src/reproduce-cli';
import { fakeClock, fakeFetch, reply } from './fake-app';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montagio-mcp-cli-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const recipe = buildRecipe(
  {
    kind: 'clip',
    task: 'camera',
    name: 'Slow Push',
    createdAt: '2026-10-24T18:00:00.000Z',
    backend: 'local',
    seed: 42,
    request: { route: '/api/generations', body: { presetId: 'slow-push', seed: 42 }, files: [{ field: 'imageRef', sha256: null }] },
    steps: [{ name: 'camera', workflow: { '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } } }, inputs: [{ node: '1', field: 'image', from: 'imageRef', sha256: null }] }],
    post: ['tag'],
  },
  { lock: [], models: [], stack: { montagio: { version: '0.1.0', commit: 'c'.repeat(40) }, comfyui: { tag: 'v0.41.0', commit: 'd'.repeat(40) }, proxy: '0.1.6', nodes: [] } },
);

function app() {
  return fakeFetch((call) => {
    if (call.path === '/api/uploads') return reply({ imageRef: 'uploads/new.png', width: 16, height: 9, aspect: '16:9', origin: 'upload', personal: true }, 201);
    if (call.method === 'POST' && call.path === '/api/generations') return reply({ id: 'g2', presetId: 'slow-push', modelId: 'm', state: 'queued', progress: 0 }, 201);
    if (call.path === '/api/generations/g2') return reply({ id: 'g2', presetId: 'slow-push', modelId: 'm', state: 'succeeded', progress: 1, outputUrl: '/media/data/generations/g2/clip.mp4' });
    if (call.path === '/api/recipes/generation/g2') return reply(recipe);
    return reply({ error: 'not-found' }, 404);
  });
}

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const clock = fakeClock();
  const code = await runCli(argv, {
    env: { MONTAGIO_URL: 'http://127.0.0.1:3000' },
    deps: { fetch: app().fetch, sleep: clock.sleep, now: clock.now },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('it renders the recipe again on the photo and says whether the workflow is the same', async () => {
  const file = join(dir, 'recipe.json');
  await writeFile(file, JSON.stringify(recipe));
  const photo = join(dir, 'photo.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=16x9', '-frames:v', '1', photo]);
  const { code, out } = await run([file, '--photo', photo]);
  expect(code).toBe(0);
  expect(out).toContain('http://127.0.0.1:3000/media/data/generations/g2/clip.mp4');
  expect(out).toContain('same workflow: yes');
  expect(out).toContain('same imageRef: unknown');
  expect(out).toMatch(/identical result on the same setup/);
});

test('without a recipe it prints how to use it and fails', async () => {
  const { code, err } = await run([]);
  expect(code).toBe(1);
  expect(err).toContain('npm run reproduce --');
});

test('a recipe that needs a photo, given none, fails with what to give', async () => {
  const file = join(dir, 'recipe.json');
  await writeFile(file, JSON.stringify(recipe));
  const { code, err } = await run([file]);
  expect(code).toBe(1);
  expect(err).toContain('imageRef');
});
