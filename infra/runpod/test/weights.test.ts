import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadFile,
  folderFor,
  lockPatch,
  parseHfUrl,
  pickCandidate,
  proposeLock,
  resolveUrl,
  weightFolders,
  type RepoListing,
} from '../lib/weights';

test('parseHfUrl reads repository, revision and path', () => {
  expect(parseHfUrl('https://huggingface.co/Comfy-Org/z_image_turbo')).toEqual({ repo: 'Comfy-Org/z_image_turbo', revision: null, path: null });
  expect(parseHfUrl('https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors')).toEqual({
    repo: 'Comfy-Org/z_image_turbo',
    revision: 'main',
    path: 'split_files/vae/ae.safetensors',
  });
  expect(() => parseHfUrl('https://example.com/a/b')).toThrow(/huggingface/);
});

test('resolveUrl builds a resolve/main file URL', () => {
  expect(resolveUrl('Comfy-Org/z_image_turbo', 'split_files/vae/ae.safetensors')).toBe(
    'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
  );
});

test('the ComfyUI folder of a weight comes from the loader that names it, else from the repository path', () => {
  const folders = weightFolders([
    {
      '4': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5.safetensors', type: 'wan' } },
      '8': { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
      '9': { class_type: 'UNETLoader', inputs: { unet_name: 'unet.safetensors' } },
    },
  ]);
  expect(Object.fromEntries(folders)).toEqual({
    'umt5.safetensors': 'text_encoders',
    'vae.safetensors': 'vae',
    'unet.safetensors': 'diffusion_models',
  });
  expect(folderFor('unet.safetensors', 'x/unet.safetensors', folders)).toBe('diffusion_models');
  expect(folderFor('lora.safetensors', 'split_files/loras/lora.safetensors', folders)).toBe('loras');
  expect(folderFor('odd.safetensors', 'odd.safetensors', folders)).toBeNull();
});

describe('pickCandidate', () => {
  const listing = (repo: string, gated: boolean, paths: string[]): RepoListing => ({
    repo,
    gated,
    revision: 'abc',
    license: 'apache-2.0',
    files: paths.map((path) => ({ path, size: 10, sha256: 'f'.repeat(64) })),
  });

  test('takes the first ungated repository holding exactly one file of that name', () => {
    const picked = pickCandidate('ae.safetensors', [
      listing('black-forest-labs/FLUX.1-schnell', true, ['ae.safetensors']),
      listing('Comfy-Org/z_image_turbo', false, ['split_files/vae/ae.safetensors']),
    ]);
    expect(picked).toMatchObject({ ok: true, repo: 'Comfy-Org/z_image_turbo', path: 'split_files/vae/ae.safetensors' });
    expect(picked.ok && picked.skipped).toEqual(['black-forest-labs/FLUX.1-schnell: gated (set HF_TOKEN to use it)']);
  });

  test('refuses an ambiguous file name and reports a missing one', () => {
    expect(pickCandidate('a.safetensors', [listing('o/r', false, ['x/a.safetensors', 'y/a.safetensors'])])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/2 files named a\.safetensors/),
    });
    expect(pickCandidate('b.safetensors', [listing('o/r', false, ['x/a.safetensors'])])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not found/),
    });
  });
});

const LOCK = `# Provisional lock: header comment kept as is.
schema: montagio/lock@0.1
weights:
  - id: vae
    file: vae.safetensors
    url: https://huggingface.co/o/r
    license: Apache-2.0
    source: https://huggingface.co/o/r
  - id: other
    file: other.safetensors
    url: https://huggingface.co/o/r
    license: Apache-2.0
    source: https://huggingface.co/o/r
`;

test('proposeLock sets url and sha256, keeps comments, order and licenses', () => {
  const sha = 'a'.repeat(64);
  const text = proposeLock(LOCK, new Map([['vae', { url: 'https://huggingface.co/o/r/resolve/main/split/vae.safetensors', sha256: sha }]]));
  expect(text).toContain('# Provisional lock: header comment kept as is.');
  expect(text).toContain(
    `    url: https://huggingface.co/o/r/resolve/main/split/vae.safetensors\n    sha256: ${sha}\n    license: Apache-2.0`,
  );
  // untouched entry stays identical
  expect(text).toContain('  - id: other\n    file: other.safetensors\n    url: https://huggingface.co/o/r\n    license: Apache-2.0');
});

test('lockPatch produces a patch that git apply accepts on the repository file', () => {
  const sha = 'b'.repeat(64);
  const proposed = proposeLock(LOCK, new Map([['vae', { url: 'https://huggingface.co/o/r/resolve/main/vae.safetensors', sha256: sha }]]));
  const repo = mkdtempSync(join(tmpdir(), 'montagio-lock-'));
  mkdirSync(join(repo, 'registry'));
  writeFileSync(join(repo, 'registry', 'models.lock.yaml'), LOCK);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const patch = lockPatch(LOCK, proposed);
  expect(patch).toMatch(/^diff --git a\/registry\/models\.lock\.yaml b\/registry\/models\.lock\.yaml/);
  writeFileSync(join(repo, 'lock.patch'), patch);
  execFileSync('git', ['apply', 'lock.patch'], { cwd: repo });
  expect(readFileSync(join(repo, 'registry', 'models.lock.yaml'), 'utf8')).toBe(proposed);
});

describe('downloadFile', () => {
  const body = Buffer.from('0123456789'.repeat(1000));
  const sha = createHash('sha256').update(body).digest('hex');
  let server: Server;
  let base: string;
  const ranges: (string | undefined)[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      ranges.push(req.headers.range);
      const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
      if (match) {
        const start = Number(match[1]);
        res.writeHead(206, { 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` });
        res.end(body.subarray(start));
      } else {
        res.writeHead(200, { 'content-length': body.length });
        res.end(body);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test('downloads, hashes and renames into place', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'montagio-dl-'));
    const result = await downloadFile(`${base}/f`, join(dir, 'f.safetensors'), { expectedSha256: sha });
    expect(result).toEqual({ sha256: sha, bytes: body.length, resumedFrom: 0 });
    expect(readFileSync(join(dir, 'f.safetensors'))).toEqual(body);
    expect(existsSync(join(dir, 'f.safetensors.part'))).toBe(false);
  });

  test('resumes a partial download with a Range request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'montagio-dl-'));
    writeFileSync(join(dir, 'f.safetensors.part'), body.subarray(0, 4000));
    ranges.length = 0;
    const result = await downloadFile(`${base}/f`, join(dir, 'f.safetensors'), { expectedSha256: sha });
    expect(ranges).toEqual(['bytes=4000-']);
    expect(result).toEqual({ sha256: sha, bytes: body.length, resumedFrom: 4000 });
    expect(readFileSync(join(dir, 'f.safetensors'))).toEqual(body);
  });

  test('a hash mismatch leaves no file in place', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'montagio-dl-'));
    await expect(downloadFile(`${base}/f`, join(dir, 'f.safetensors'), { expectedSha256: 'c'.repeat(64) })).rejects.toThrow(/sha256 mismatch/);
    expect(existsSync(join(dir, 'f.safetensors'))).toBe(false);
    expect(existsSync(join(dir, 'f.safetensors.part'))).toBe(false);
  });
});
