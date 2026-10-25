import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InputSlot } from '@montagio/recipe';
import { POST as postEffects } from '@/app/api/effects/route';
import { POST as postGeneration } from '@/app/api/generations/route';
import { POST as postHooks } from '@/app/api/hooks/route';
import { POST as postImages } from '@/app/api/images/route';
import { GET as getRecipe } from '@/app/api/recipes/[source]/[id]/route';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as postSequence } from '@/app/api/sequences/route';
import { GET as getSequence } from '@/app/api/sequences/[id]/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { jobs } from '@/server/jobs';
import { getServices } from '@/server/services';
import { readInputs, readRecord, readWorkflow } from '@/server/store';
import { generationRequest, params, setupTempData } from './helpers';

const dataDir = setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
  process.env.MONTAGIO_DEMO_DURATION_MS = '0';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const jsonRequest = (route: string, body: unknown, key: string) =>
  new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
const sampleRef = async () => ((await (await postSampleUpload()).json()) as { imageRef: string }).imageRef;
const fileSha = (imageRef: string) => createHash('sha256').update(readFileSync(join(dataDir(), ...imageRef.split('/')))).digest('hex');
const stepInputs = (jobId: string, index: number) =>
  JSON.parse(readFileSync(join(dataDir(), 'jobs', jobId, `step${index}.inputs.json`), 'utf8')) as InputSlot[];
const pollJob = async (id: string) => (await (await getJob(new Request('http://localhost/x'), params({ id }))).json()) as { state: string };

describe('the input files of each step, by sha256', () => {
  test('a camera clip notes its start photo on the node the model binds it to', async () => {
    const imageRef = await sampleRef();
    const res = await postGeneration(generationRequest({ presetId: 'slow-push', imageRef }, 'in-gen'));
    const record = (await res.json()) as { id: string; modelId: string };
    const binding = (await getServices().library).models.get(record.modelId)!.bindings.image!;
    expect(await readInputs(record.id)).toEqual([{ node: binding.node, field: binding.field, from: 'imageRef', sha256: fileSha(imageRef) }]);
  });

  test('an effect notes its photo as the input of its one step', async () => {
    const imageRef = await sampleRef();
    const job = (await (await postEffects(jsonRequest('/api/effects', { imageRef, effectId: 'squish' }, 'in-fx'))).json()) as { id: string };
    expect(stepInputs(job.id, 0)).toEqual([expect.objectContaining({ from: 'imageRef', sha256: fileSha(imageRef) })]);
  });

  test('the second step of a hook takes the first step output, and says so', async () => {
    const imageRef = await sampleRef();
    const job = (await (await postHooks(jsonRequest('/api/hooks', { imageRef, hookId: 'iris-dive' }, 'in-hook'))).json()) as { id: string };
    await pollJob(job.id); // the edit is done: the transition is submitted
    const froms = stepInputs(job.id, 1).map((slot) => slot.from);
    expect(froms).toContain('step:0');
    expect(froms).toContain('imageRef');
    expect(stepInputs(job.id, 1).every((slot) => /^[a-f0-9]{64}$/.test(slot.sha256 ?? ''))).toBe(true);
  });
});

describe('the negative prompt of a showcase clip, given again', () => {
  test('a camera clip renders on the negative it is sent, and its recipe asks for it again', async () => {
    const imageRef = await sampleRef();
    const negative = 'blurry, transparent boat, ghost';
    const record = (await (await postGeneration(generationRequest({ presetId: 'slow-push', imageRef, negative }, 'neg'))).json()) as { id: string; modelId: string };
    const binding = (await getServices().library).models.get(record.modelId)!.bindings.negative!;
    expect((await readWorkflow(record.id))![binding.node]!.inputs[binding.field]).toBe(negative);
    const recipe = (await (await getRecipe(new Request('http://localhost/x'), params({ source: 'generation', id: record.id }))).json()) as { request: { body: Record<string, unknown> } };
    expect(recipe.request.body.negative).toBe(negative);
  });

  test('a negative longer than 500 characters is cut, as the description is', async () => {
    const imageRef = await sampleRef();
    const record = (await (await postGeneration(generationRequest({ presetId: 'slow-push', imageRef, negative: 'x'.repeat(600) }, 'neg-long'))).json()) as { id: string; modelId: string };
    const binding = (await getServices().library).models.get(record.modelId)!.bindings.negative!;
    expect(String((await readWorkflow(record.id))![binding.node]!.inputs[binding.field])).toHaveLength(500);
  });
});

describe('a seed given again', () => {
  test('a job takes the seed it is sent', async () => {
    const imageRef = await sampleRef();
    const job = (await (await postEffects(jsonRequest('/api/effects', { imageRef, effectId: 'squish', seed: 1234 }, 'sd-fx'))).json()) as { id: string };
    expect((await jobs.read(job.id))!.seed).toBe(1234);
  });

  test.each([-1, 2 ** 32, '12', 1.5])('a seed of %s is ignored: the job draws its own', async (seed) => {
    const imageRef = await sampleRef();
    const job = (await (await postEffects(jsonRequest('/api/effects', { imageRef, effectId: 'squish', seed }, `sd-bad-${seed}`))).json()) as { id: string };
    const drawn = (await jobs.read(job.id))!.seed;
    expect(Number.isInteger(drawn) && drawn >= 0 && drawn < 2 ** 32).toBe(true);
    expect(drawn).not.toBe(seed);
  });

  test('a photo made from a text refuses a seed past 2^32 the same way', async () => {
    const job = (await (await postImages(jsonRequest('/api/images', { prompt: 'A lighthouse', aspect: '16:9', seed: 2 ** 32 }, 'sd-t2i'))).json()) as { id: string };
    expect((await jobs.read(job.id))!.seed).toBeLessThan(2 ** 32);
  });

  test('a camera clip refuses a negative seed the same way', async () => {
    const imageRef = await sampleRef();
    const record = (await (await postGeneration(generationRequest({ presetId: 'slow-push', imageRef, seed: -1 }, 'sd-gen'))).json()) as { seed: number };
    expect(record.seed).toBeGreaterThanOrEqual(0);
  });

  test('each shot of a film takes its own seed', async () => {
    const imageRef = await sampleRef();
    const body = { imageRef, shots: [{ presetId: 'slow-push', seed: 7 }, { presetId: 'pan-left', seed: 8 }] };
    const film = (await (await postSequence(jsonRequest('/api/sequences', body, 'sd-film'))).json()) as { id: string };
    let record: { state: string; shots: { generationId?: string }[] } = { state: 'running', shots: [] };
    // The montage runs apart from the polls: wait for it.
    for (let i = 0; i < 300 && !['succeeded', 'failed'].includes(record.state); i++) {
      record = await (await getSequence(new Request('http://localhost/x'), params({ id: film.id }))).json();
      if (record.state === 'assembling') await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(record.state).toBe('succeeded');
    const seeds = await Promise.all(record.shots.map(async (shot) => (await readRecord(shot.generationId!))!.seed));
    expect(seeds).toEqual([7, 8]);
  });
});
