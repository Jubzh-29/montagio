import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET as getCommunityPreset } from '@/app/api/community/[id]/preset/route';
import { GET as getRecipe } from '@/app/api/community/[id]/recipe/route';
import { DELETE as deleteEntry, GET as getEntry } from '@/app/api/community/[id]/route';
import { POST as postImport } from '@/app/api/community/import/route';
import { GET as listCommunity, POST as publish } from '@/app/api/community/route';
import { GET as getGeneration } from '@/app/api/generations/[id]/route';
import { POST as postGenerations } from '@/app/api/generations/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import type { GenerationRecord, JobSummary } from '@/lib/api-types';
import { parseRecipe, recipeFileName, shareableReprise, type CommunityEntry, type Recipe } from '@/lib/community';
import { mediaFileFor } from '@/server/generations';
import { generationRequest, params, repoRoot, setupTempData } from './helpers';

setupTempData();
beforeEach(() => {
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = () => new Request('http://localhost/x');

async function photoJob(key: string): Promise<JobSummary> {
  const res = await postImages(json({ prompt: 'a lighthouse on a cliff at dusk', aspect: '16:9' }, { 'idempotency-key': key }));
  const { id } = (await res.json()) as JobSummary;
  for (let i = 0; i < 20; i++) {
    const job = (await (await getJob(get(), params({ id }))).json()) as JobSummary;
    if (job.state === 'succeeded') return job;
  }
  throw new Error('the photo did not settle');
}

const recipe = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'montagio/recipe@0.1',
  title: 'Golden harbour push',
  author: 'Mira',
  kind: 'clip',
  task: 'camera',
  name: 'Slow Push',
  reprise: { tab: 'camera', presetId: 'slow-push', prompt: 'a fishing harbour at golden hour', imageRef: 'uploads/secret.png', videoRef: 'v.mp4' },
  createdAt: '2026-10-24T10:00:00.000Z',
  ...overrides,
});

describe('recipes', () => {
  test('a recipe keeps the settings and drops the photo, the clip and anything unknown', () => {
    const parsed = parseRecipe({ ...recipe(), extra: 'x' })!;
    expect(parsed.reprise).toEqual({ tab: 'camera', presetId: 'slow-push', prompt: 'a fishing harbour at golden hour', sample: true });
    expect(parsed).not.toHaveProperty('extra');
    expect(shareableReprise({ tab: 'effects', effectId: 'squish', imageRef: 'uploads/me.png', personal: true, remixGenerationId: 'g' })).toEqual({ tab: 'effects', effectId: 'squish', sample: true });
  });

  test('a file that is not a recipe, or one with a bad field, is refused', () => {
    expect(parseRecipe(null)).toBeNull();
    expect(parseRecipe({ ...recipe(), schema: 'montagio/recipe@9' })).toBeNull();
    expect(parseRecipe({ ...recipe(), title: '' })).toBeNull();
    expect(parseRecipe({ ...recipe(), title: 'x'.repeat(81) })).toBeNull();
    expect(parseRecipe({ ...recipe(), reprise: { tab: 'nowhere' } })).toBeNull();
    expect(parseRecipe({ ...recipe(), presetYaml: 'id: x' , reprise: { tab: 'effects' } })).toBeNull();
    expect(parseRecipe({ ...recipe(), reprise: { tab: 'camera', presetId: '../../etc' } })!.reprise.presetId).toBeUndefined();
  });

  test('a recipe downloads under its title', () => {
    expect(recipeFileName('Café au port — test')).toBe('cafe-au-port-test.montagio.json');
    expect(recipeFileName('***')).toBe('recipe.montagio.json');
  });
});

describe('the community gallery', () => {
  test('the examples are the catalogue, each remixed on its sample photo', async () => {
    const entries = (await (await listCommunity()).json()) as CommunityEntry[];
    const move = entries.find((entry) => entry.id === 'move-crash-push');
    expect(move).toMatchObject({ source: 'example', task: 'camera', reprise: { tab: 'camera', presetId: 'crash-push', sample: true } });
    expect(await (await getEntry(get(), params({ id: 'move-crash-push' }))).json()).toEqual(move);
    expect((await getEntry(get(), params({ id: 'nope' }))).status).toBe(404);
  });

  test('a creation of the history is published with a copy of its media and its settings; its recipe shares no photo', async () => {
    const job = await photoJob('c-photo-1');
    const res = await publish(json({ historyKey: `job:${job.id}`, title: 'Lighthouse', author: 'Mira' }));
    expect(res.status).toBe(201);
    const entry = (await res.json()) as CommunityEntry;
    expect(entry).toMatchObject({ source: 'local', title: 'Lighthouse', author: 'Mira', kind: 'photo', task: 't2i' });
    expect(entry.previewUrl).toMatch(/^\/media\/data\/community\/[0-9a-f-]{36}\.png$/);
    expect(existsSync(mediaFileFor(entry.previewUrl)!)).toBe(true);
    const listed = (await (await listCommunity()).json()) as CommunityEntry[];
    expect(listed[0]!.id).toBe(entry.id);

    const download = await getRecipe(get(), params({ id: entry.id }));
    expect(download.headers.get('content-disposition')).toContain('lighthouse.montagio.json');
    const shared = (await download.json()) as Recipe;
    expect(shared).toMatchObject({ schema: 'montagio/recipe@0.1', title: 'Lighthouse', author: 'Mira' });
    expect(JSON.stringify(shared)).not.toContain('imageRef');
    expect(shared.reprise.sample).toBe(true);

    expect((await deleteEntry(get(), params({ id: entry.id }))).status).toBe(204);
    expect(existsSync(mediaFileFor(entry.previewUrl)!)).toBe(false);
    expect((await deleteEntry(get(), params({ id: 'move-crash-push' }))).status).toBe(404);
  });

  test('publishing needs a known creation and a title; a famous name is refused', async () => {
    expect((await publish(json({ historyKey: 'job:nope', title: 'x' }))).status).toBe(404);
    const job = await photoJob('c-photo-2');
    expect((await publish(json({ historyKey: `job:${job.id}`, title: '  ' }))).status).toBe(400);
    expect(await (await publish(json({ historyKey: `job:${job.id}`, title: 'Barack Obama at sea' }))).json()).toEqual({ error: 'blocked-name' });
  });

  test('a remixed move keeps its preset text: the Studio reopens it from the gallery', async () => {
    const imageRef = ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
    const yaml = readFileSync(join(repoRoot, 'presets', 'crash-push.yaml'), 'utf8').replace('speed: 1.5', 'speed: 0.8');
    const created = (await (await postGenerations(generationRequest({ presetYaml: yaml, imageRef }, 'c-rx'))).json()) as GenerationRecord;
    for (let i = 0; i < 20; i++) {
      const record = (await (await getGeneration(get(), params({ id: created.id }))).json()) as GenerationRecord;
      if (record.state === 'succeeded') break;
    }
    const entry = (await (await publish(json({ historyKey: `generation:${created.id}`, title: 'Slower crash' }))).json()) as CommunityEntry;
    expect(entry.reprise).toMatchObject({ presetId: 'crash-push', presetUrl: `/api/community/${entry.id}/preset` });
    expect(entry.reprise.remixGenerationId).toBeUndefined();
    expect(await (await getCommunityPreset(get(), params({ id: entry.id }))).text()).toBe(yaml);
    const shared = (await (await getRecipe(get(), params({ id: entry.id }))).json()) as Recipe;
    expect(shared.presetYaml).toBe(yaml);

    // That recipe, imported elsewhere: the same settings and preset, the example's clip as its picture.
    const imported = (await (await postImport(json(shared))).json()) as CommunityEntry;
    expect(imported).toMatchObject({ source: 'imported', title: 'Slower crash', reprise: { tab: 'camera', presetId: 'crash-push', sample: true } });
    expect(imported.previewUrl).toBeTruthy();
    expect(await (await getCommunityPreset(get(), params({ id: imported.id }))).text()).toBe(yaml);
  });

  test('an import that is not a recipe is refused', async () => {
    expect(await (await postImport(json({ hello: 'world' }))).json()).toEqual({ error: 'invalid-recipe' });
    expect(await (await postImport(json(recipe({ title: 'Kamala Harris remix' })))).json()).toEqual({ error: 'blocked-name' });
  });
});

test('another site cannot publish nor import: plain text or a cross-site request is refused', async () => {
  const plain = new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(recipe()) });
  expect((await postImport(plain)).status).toBe(403);
  expect((await postImport(json(recipe(), { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  expect((await publish(json({ historyKey: 'job:x', title: 'x' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  expect((await postImport(json(recipe(), { 'sec-fetch-site': 'same-origin' }))).status).toBe(201);
});
