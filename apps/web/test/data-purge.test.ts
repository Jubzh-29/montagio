import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemotePurgeError } from '@montagio/comfy-adapter';
import { POST as purgeRoute } from '@/app/api/data/purge/route';
import { POST as sampleRoute } from '@/app/api/uploads/sample/route';
import { POST as remixSampleRoute } from '@/app/api/uploads/remix/sample/route';
import { POST as libraryRoute } from '@/app/api/uploads/video/library/route';
import { POST as importRoute } from '@/app/api/remix/import/route';
import { assertDataWritable, DataPurgeError, dataWritesActive, purgeStudioData, withDataWrite } from '@/server/data-purge';
import { canConfirmPurge } from '@/lib/data-purge';
import { seedRecordFile, setupTempData } from './helpers';

const dataDir = setupTempData();
const DIRS = ['uploads', 'generations', 'sequences', 'jobs', 'community', 'characters', 'shares', 'comfy-outputs', 'demo-renders', 'tmp', 'remix-link-one', 'remix-sample-one'];

function seedFile(relative: string, content = 'personal'): string {
  const path = join(dataDir(), relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function seedAll(): void {
  for (const dir of DIRS) seedFile(join(dir, 'media.bin'));
  seedFile('keep.txt', 'keep');
  seedRecordFile(dataDir(), { id: 'generation-one', state: 'succeeded', backendJobId: 'generation-backend', backendKind: 'demo' });
  seedFile('jobs/job-one/record.json', JSON.stringify({ id: 'job-one', state: 'succeeded', backendKind: 'demo', steps: [{ backendJobId: 'job-backend' }] }));
}

function request(site = 'same-origin'): Request {
  return new Request('http://localhost/api/data/purge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
    body: '{}',
  });
}

test('a complete purge removes only documented data, then succeeds on empty data', async () => {
  seedAll();
  const outside = join(dataDir(), '..', 'outside.txt');
  writeFileSync(outside, 'outside');
  const backend = { purge: vi.fn().mockResolvedValue(undefined) };
  await purgeStudioData({ backend });
  expect(backend.purge).toHaveBeenCalledWith(['generation-backend', 'job-backend']);
  for (const dir of DIRS) expect(existsSync(join(dataDir(), dir))).toBe(false);
  expect(existsSync(join(dataDir(), 'keep.txt'))).toBe(true);
  expect(existsSync(outside)).toBe(true);
  await purgeStudioData({ backend });
});

test('active work blocks the purge before any remote or local deletion', async () => {
  seedAll();
  seedRecordFile(dataDir(), { id: 'generation-active', state: 'running', backendJobId: 'active-backend' });
  const backend = { purge: vi.fn().mockResolvedValue(undefined) };
  await expect(purgeStudioData({ backend })).rejects.toMatchObject({ code: 'data-busy' });
  expect(backend.purge).not.toHaveBeenCalled();
  expect(existsSync(join(dataDir(), 'uploads', 'media.bin'))).toBe(true);
});

test('a running share blocks the purge', async () => {
  seedAll();
  seedFile('shares/share-one/state.json', JSON.stringify({ state: 'running' }));
  await expect(purgeStudioData({ backend: { purge: vi.fn() } })).rejects.toMatchObject({ code: 'data-busy' });
  expect(existsSync(join(dataDir(), 'shares', 'share-one', 'state.json'))).toBe(true);
});

test('a caption export running under a finished job blocks the purge', async () => {
  seedAll();
  seedFile('jobs/job-one/exports/export-one/state.json', JSON.stringify({ state: 'running' }));
  await expect(purgeStudioData({ backend: { purge: vi.fn() } })).rejects.toMatchObject({ code: 'data-busy' });
  expect(existsSync(join(dataDir(), 'jobs', 'job-one', 'exports', 'export-one', 'state.json'))).toBe(true);
});

test('an unchecked remote failure leaves every local file for retry', async () => {
  seedAll();
  const backend = { purge: vi.fn().mockRejectedValue(new RemotePurgeError('offline')) };
  await expect(purgeStudioData({ backend })).rejects.toMatchObject({ code: 'remote-purge-incomplete' });
  expect(existsSync(join(dataDir(), 'uploads', 'media.bin'))).toBe(true);
  expect(existsSync(join(dataDir(), 'generations', 'generation-one', 'record.json'))).toBe(true);
});

test('an unreadable legacy record is an incomplete purge, never an empty inventory', async () => {
  seedAll();
  seedFile('generations/legacy/record.json', '{not json');
  const backend = { purge: vi.fn().mockResolvedValue(undefined) };
  await expect(purgeStudioData({ backend })).rejects.toMatchObject({ code: 'remote-purge-incomplete' });
  expect(backend.purge).not.toHaveBeenCalled();
  expect(existsSync(join(dataDir(), 'generations', 'legacy', 'record.json'))).toBe(true);
});

test('a concurrent purge is refused and creation stays blocked until the first ends', async () => {
  seedAll();
  let release = () => {};
  const backend = { purge: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { release = resolve; })) };
  const first = purgeStudioData({ backend });
  await vi.waitFor(() => expect(backend.purge).toHaveBeenCalled());
  await expect(purgeStudioData({ backend })).rejects.toMatchObject({ code: 'data-purging' });
  expect(() => assertDataWritable()).toThrow(DataPurgeError);
  release();
  await first;
  expect(() => assertDataWritable()).not.toThrow();
});

test('the route is JSON same-site only and maps an empty purge to 204', async () => {
  expect((await purgeRoute(request('cross-site'))).status).toBe(403);
  expect((await purgeRoute(request('same-site'))).status).toBe(403);
  expect((await purgeRoute(request())).status).toBe(204);
});

test('the confirmation phrase is exact and localized', () => {
  expect(canConfirmPurge('DELETE', 'en')).toBe(true);
  expect(canConfirmPurge('EFFACER', 'fr')).toBe(true);
  expect(canConfirmPurge('delete', 'en')).toBe(false);
  expect(canConfirmPurge('DELETE ', 'en')).toBe(false);
  expect(canConfirmPurge('EFFACER', 'en')).toBe(false);
});


test('a creation already in flight blocks the purge until its final write', async () => {
  seedAll();
  let release = () => {};
  const creation = withDataWrite(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    seedFile('community/imported.json', 'created-after-purge-attempt');
  });
  await vi.waitFor(() => expect(dataWritesActive()).toBe(true));
  await expect(purgeStudioData({ backend: { purge: vi.fn() } })).rejects.toMatchObject({ code: 'data-busy' });
  release();
  await creation;
  expect(existsSync(join(dataDir(), 'community', 'imported.json'))).toBe(true);
  expect(dataWritesActive()).toBe(false);
});

test('a recorded local backend cannot be purged under demo mode', async () => {
  seedAll();
  seedRecordFile(dataDir(), { id: 'local-generation', state: 'succeeded', backendJobId: 'remote-job', backendKind: 'local' });
  const backend = { purge: vi.fn().mockResolvedValue(undefined) };
  await expect(purgeStudioData({ backend })).rejects.toMatchObject({ code: 'remote-purge-incomplete' });
  expect(backend.purge).not.toHaveBeenCalled();
  expect(existsSync(join(dataDir(), 'generations', 'local-generation', 'record.json'))).toBe(true);
});

test('a null legacy record is unreadable, not an empty inventory', async () => {
  seedAll();
  seedFile('generations/null/record.json', 'null');
  await expect(purgeStudioData({ backend: { purge: vi.fn() } })).rejects.toMatchObject({ code: 'remote-purge-incomplete' });
  expect(existsSync(join(dataDir(), 'generations', 'null', 'record.json'))).toBe(true);
});

test('an unreadable activity state counts as active work', async () => {
  seedAll();
  seedFile('shares/broken/state.json', 'null');
  await expect(purgeStudioData({ backend: { purge: vi.fn() } })).rejects.toMatchObject({ code: 'data-busy' });
  expect(existsSync(join(dataDir(), 'shares', 'broken', 'state.json'))).toBe(true);
});


test('creation routes answer 409 data-purging instead of escaping or becoming 404', async () => {
  let release = () => {};
  const backend = { purge: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { release = resolve; })) };
  const first = purgeStudioData({ backend });
  await vi.waitFor(() => expect(backend.purge).toHaveBeenCalled());
  process.env.MONTAGIO_BACKEND = 'local';
  process.env.COMFY_BASE_URL = 'http://127.0.0.1:9';
  try {
    for (const response of [
      await sampleRoute(request()),
      await remixSampleRoute(request()),
      await libraryRoute(new Request('http://localhost/api/uploads/video/library', {
        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ id: 'hip-hop' }),
      })),
      await importRoute(new Request('http://localhost/api/remix/import', {
        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ url: 'https://youtu.be/abc', rights: true }),
      })),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'data-purging' });
    }
  } finally {
    process.env.MONTAGIO_BACKEND = 'demo';
    delete process.env.COMFY_BASE_URL;
    release();
    await first;
  }
});


test('a recorded local backend is purged only by the same authenticated proxy origin', async () => {
  seedAll();
  seedRecordFile(dataDir(), {
    id: 'local-generation', state: 'succeeded', backendJobId: 'remote-job', backendKind: 'local', backendOrigin: 'http://127.0.0.1:8189',
  });
  const backend = { kind: 'local' as const, origin: 'http://127.0.0.1:8189', purge: vi.fn().mockResolvedValue(undefined) };
  await purgeStudioData({ backend });
  expect(backend.purge).toHaveBeenCalledWith(['generation-backend', 'remote-job', 'job-backend']);
});
