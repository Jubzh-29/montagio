import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GET as getGenerationPreset } from '@/app/api/generations/[id]/preset/route';
import { POST as postGenerations } from '@/app/api/generations/route';
import { POST as postValidateRoute } from '@/app/api/presets/validate/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { GET as getWorkflow } from '@/app/api/workflows/[id]/route';
import { loadLibrary } from '@montagio/presets';
import { generationRequest, params, pngFile, repoRoot, setupTempData, uploadRequest } from './helpers';

const dataDir = setupTempData();
const yaml = readFileSync(join(repoRoot, 'presets', 'crash-push.yaml'), 'utf8');

const postValidate = (body: unknown) =>
  postValidateRoute(
    new Request('http://localhost/api/presets/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

async function uploadedImageRef(): Promise<string> {
  return ((await (await postUpload(uploadRequest(pngFile(1920, 1080)))).json()) as { imageRef: string }).imageRef;
}

/** Nine levels of nine aliases: 9^9 strings once expanded. */
const billionLaughs = ['a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]']
  .concat(
    ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((name, i) => {
      const previous = 'abcdefgh'[i]!;
      return `${name}: &${name} [${Array.from({ length: 9 }, () => `*${previous}`).join(',')}]`;
    }),
  )
  .join('\n');

describe('POST /api/presets/validate', () => {
  test('a valid remix -> 200 with its summary', async () => {
    const res = await postValidate({ yaml: yaml.replace('speed: 1.5', 'speed: 0.8') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      preset: { id: 'crash-push', name: 'Crash Push', poses: ['zoom_in'], speed: 0.8 },
    });
  });

  test('a typo -> 422 naming the field', async () => {
    const res = await postValidate({ yaml: yaml.replace('speed: 1.5', 'sped: 1.5') });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid-preset', problems: [expect.stringMatching(/camera.*sped/)] });
  });

  test('the chosen model is the one the dry compile uses', async () => {
    const res = await postValidate({ yaml, modelId: 'z-image-turbo' });
    expect(res.status).toBe(422);
    expect((await res.json()).problems).toContainEqual(expect.stringMatching(/^model z-image-turbo: /));
  });

  test('more than 16 KiB -> 413, counted in UTF-8 bytes', async () => {
    expect((await postValidate({ yaml: yaml + '#'.repeat(16 * 1024) })).status).toBe(413);
    // 6000 characters, 18000 bytes
    const res = await postValidate({ yaml: `${yaml}# ${'€'.repeat(6000)}\n` });
    expect([res.status, await res.json()]).toEqual([413, { error: 'preset-too-large' }]);
  });

  test('a 16 KiB remix is accepted', async () => {
    const padded = `${yaml}#`.padEnd(16 * 1024 - 1, '#') + '\n';
    expect(Buffer.byteLength(padded, 'utf8')).toBe(16 * 1024);
    expect((await postValidate({ yaml: padded })).status).toBe(200);
  });

  test('a 1 MB body is refused quickly with 413', async () => {
    const t0 = Date.now();
    expect((await postValidate({ yaml: 'x'.repeat(1024 * 1024) })).status).toBe(413);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('an alias bomb is refused quickly', async () => {
    const t0 = Date.now();
    const res = await postValidate({ yaml: billionLaughs });
    expect(res.status).toBe(422);
    expect((await res.json()).problems).toEqual([expect.stringMatching(/^invalid YAML/)]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('a non-string yaml -> 400', async () => {
    expect((await postValidate({ yaml: 42 })).status).toBe(400);
    expect((await postValidate({})).status).toBe(400);
    expect((await postValidate('not json')).status).toBe(400);
    expect(await (await postValidate({ yaml: ['id: x'] })).json()).toEqual({ error: 'invalid-request' });
  });
});

describe('remixed generations', () => {
  test('a remixed generation compiles the edited preset and keeps its text', async () => {
    const imageRef = await uploadedImageRef();
    const text = yaml.replace('speed: 1.5', 'speed: 0.8');
    const res = await postGenerations(generationRequest({ presetYaml: text, imageRef }, 'rx1'));
    const rec = await res.json();
    expect([res.status, rec.presetId, rec.remix]).toEqual([201, 'crash-push', true]);
    const workflow = await (await getWorkflow(new Request('http://localhost/x'), params({ id: rec.id }))).json();
    const speed = (await loadLibrary(repoRoot)).models.get(rec.modelId)!.bindings.camera_speed!;
    expect(workflow[speed.node].inputs[speed.field]).toBe(0.8);
    expect(await readFile(join(dataDir(), 'generations', rec.id, 'preset.yaml'), 'utf8')).toBe(text);
  });

  test('a generation from the library is not a remix', async () => {
    const imageRef = await uploadedImageRef();
    const rec = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'rx2'))).json();
    expect(rec.remix).toBeUndefined();
    expect(existsSync(join(dataDir(), 'generations', rec.id, 'preset.yaml'))).toBe(false);
  });

  test('an invalid remix is refused before any render', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetYaml: yaml.replace('speed: 1.5', 'sped: 1.5'), imageRef }, 'rx3'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-preset', problems: [expect.stringMatching(/camera.*sped/)] });
    expect(existsSync(join(dataDir(), 'generations'))).toBe(false);
  });

  test('a remix that does not compile on the chosen model is refused', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetYaml: yaml, modelId: 'z-image-turbo', imageRef }, 'rx4'));
    expect(res.status).toBe(400);
    expect((await res.json()).problems).toContainEqual(expect.stringMatching(/^model z-image-turbo: /));
  });

  test('a remix larger than 16 KiB -> 413', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetYaml: yaml + '#'.repeat(16 * 1024), imageRef }, 'rx5'));
    expect([res.status, await res.json()]).toEqual([413, { error: 'preset-too-large' }]);
    expect(existsSync(join(dataDir(), 'generations'))).toBe(false);
  });

  test('a remixed generation serves its own preset text, as it was sent', async () => {
    const imageRef = await uploadedImageRef();
    const text = yaml.replace('speed: 1.5', 'speed: 0.8').replace('name: Crash Push', 'name: Crash Push (é)');
    const { id } = await (await postGenerations(generationRequest({ presetYaml: text, imageRef }, 'rx7'))).json();
    const res = await getGenerationPreset(new Request('http://localhost/x'), params({ id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/yaml; charset=utf-8');
    expect(await res.text()).toBe(text);
  });

  test('a library generation, an unknown id or a path has no preset text of its own -> 404', async () => {
    const imageRef = await uploadedImageRef();
    const { id } = await (await postGenerations(generationRequest({ presetId: 'crash-push', imageRef }, 'rx8'))).json();
    for (const missing of [id, 'no-such-generation', '..', '../../presets/crash-push']) {
      const res = await getGenerationPreset(new Request('http://localhost/x'), params({ id: missing }));
      expect([missing, res.status, await res.json()]).toEqual([missing, 404, { error: 'not-found' }]);
    }
  });

  test('neither presetId nor presetYaml -> 400 invalid-request', async () => {
    const imageRef = await uploadedImageRef();
    const res = await postGenerations(generationRequest({ presetYaml: 7, imageRef }, 'rx6'));
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid-request' }]);
  });
});
