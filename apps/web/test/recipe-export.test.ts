import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecipe, type CompactRecipe, type Recipe } from '@montagio/recipe';
import { readImageTags, readTags, RECIPE_TAG } from '@montagio/sequence';
import { POST as postGeneration } from '@/app/api/generations/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { GET as getRecipe } from '@/app/api/recipes/[source]/[id]/route';
import { POST as postSequence } from '@/app/api/sequences/route';
import { GET as getSequence } from '@/app/api/sequences/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { mediaFileFor } from '@/server/generations';
import { generationRequest, params, repoRoot, setupTempData } from './helpers';

setupTempData();
beforeEach(() => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});

const jsonRequest = (route: string, body: unknown, key: string) =>
  new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const recipeOf = async (source: string, id: string) =>
  (await (await getRecipe(new Request(`http://localhost/api/recipes/${source}/${id}`), params({ source, id }))).json()) as Recipe;

function compactOf(text: string | undefined): CompactRecipe {
  expect(text).toBeDefined();
  const parsed = parseRecipe(JSON.parse(text!));
  expect(parsed.ok).toBe(true);
  return (parsed as { ok: true; recipe: CompactRecipe }).recipe;
}

async function settledGeneration(body: Record<string, unknown>, key: string): Promise<{ id: string; outputUrl: string }> {
  const { id } = (await (await postGeneration(generationRequest(body, key))).json()) as { id: string };
  let record: { state: string; outputUrl?: string } = { state: 'queued' };
  for (let i = 0; i < 20 && record.state !== 'succeeded'; i++) record = await (await getGeneration(new Request('http://localhost/x'), params({ id }))).json();
  expect(record.state).toBe('succeeded');
  return { id, outputUrl: record.outputUrl! };
}

test('a delivered camera clip carries its compact recipe beside the AI-generated mention', async () => {
  const { id, outputUrl } = await settledGeneration({ presetId: 'slow-push', imageRef: await sampleRef() }, 'ex-gen');
  const tags = await readTags(mediaFileFor(outputUrl)!);
  expect(tags.comment).toBe('AI-generated');
  const compact = compactOf(tags[RECIPE_TAG.video]);
  const full = await recipeOf('generation', id);
  expect(compact).toMatchObject({ compact: true, seed: full.seed, task: 'camera' });
  expect(compact.steps[0]!.workflowSha256).toBe(full.steps[0]!.workflowSha256);
  expect(compact.request).toEqual(full.request);
}, 30_000);

test('an image made from a text carries it in a PNG text chunk', async () => {
  const created = (await (await postImages(jsonRequest('/api/images', { prompt: 'A lighthouse at dusk', aspect: '16:9' }, 'ex-t2i'))).json()) as { id: string };
  let job: { state: string; outputUrl?: string } = { state: 'queued' };
  for (let i = 0; i < 20 && job.state !== 'succeeded'; i++) job = await (await getJob(new Request('http://localhost/x'), params({ id: created.id }))).json();
  expect(job.state).toBe('succeeded');
  const tags = await readImageTags(mediaFileFor(job.outputUrl)!);
  expect(tags.Comment).toBe('AI-generated');
  const compact = compactOf(tags[RECIPE_TAG.image]);
  expect(compact.steps[0]!.workflowSha256).toBe((await recipeOf('job', created.id)).steps[0]!.workflowSha256);
}, 30_000);

test('a film and its 9:16 cut carry the recipe of the film', async () => {
  const body = { imageRef: await sampleRef(), shots: [{ presetId: 'slow-push', seed: 7 }, { presetId: 'pan-left', seed: 8 }] };
  const { id } = (await (await postSequence(jsonRequest('/api/sequences', body, 'ex-film'))).json()) as { id: string };
  let film: { state: string; outputUrl?: string; verticalUrl?: string } = { state: 'running' };
  for (let i = 0; i < 300 && !['succeeded', 'failed'].includes(film.state); i++) {
    film = await (await getSequence(new Request('http://localhost/x'), params({ id }))).json();
    if (film.state === 'assembling') await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(film.state).toBe('succeeded');
  for (const url of [film.outputUrl, film.verticalUrl]) {
    const compact = compactOf((await readTags(mediaFileFor(url)!))[RECIPE_TAG.video]);
    expect(compact).toMatchObject({ kind: 'film', seed: 7 });
    expect(compact.steps.map((step) => step.name)).toEqual(['shot 1', 'shot 2']);
  }
}, 60_000);

test('a 16 KiB remix leaves its text out of the tags, under 8 KiB, and says so', async () => {
  const text = readFileSync(join(repoRoot, 'presets', 'slow-push.yaml'), 'utf8');
  const presetYaml = `${text}\n# ${'padding '.repeat(Math.floor((16 * 1024 - text.length - 64) / 8))}\n`;
  const { outputUrl } = await settledGeneration({ presetYaml, imageRef: await sampleRef() }, 'ex-remix');
  const tag = (await readTags(mediaFileFor(outputUrl)!))[RECIPE_TAG.video]!;
  expect(tag.length).toBeLessThanOrEqual(8192);
  const compact = compactOf(tag);
  expect(compact.truncated).toBe(true);
  expect(compact.preset).toMatchObject({ id: 'slow-push', remix: true });
}, 30_000);
