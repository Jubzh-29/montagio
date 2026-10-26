import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LockWeight } from '../src/pins.ts';
import { emptyState, readState, recordWeights, withProxyToken, writeState } from '../src/state.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'montagio state '));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a full install gets one proxy token, kept from then on; the app alone and an empty state get none", () => {
  const full = withProxyToken({ ...emptyState(), mode: 'full' });
  expect(full.proxyToken).toMatch(/^[0-9a-f]{64}$/);
  expect(withProxyToken(full)).toBe(full);
  expect(withProxyToken({ ...emptyState(), mode: 'full' }).proxyToken).not.toBe(full.proxyToken);
  expect(withProxyToken({ ...emptyState(), mode: 'app-only' }).proxyToken).toBeNull();
  expect(withProxyToken(emptyState()).proxyToken).toBeNull();
});

test('a missing, corrupt or foreign state file reads as an empty state', () => {
  expect(readState(join(dir, 'absent.json'))).toEqual(emptyState());
  writeFileSync(join(dir, 'corrupt.json'), '{"schema": "montagio/install@0.1", "mode": ');
  expect(readState(join(dir, 'corrupt.json'))).toEqual(emptyState());
  writeFileSync(join(dir, 'other.json'), JSON.stringify({ schema: 'something/else', mode: 'full' }));
  expect(readState(join(dir, 'other.json'))).toEqual(emptyState());
});

test('the empty state has the default ports and no stamp', () => {
  expect(emptyState()).toEqual({
    schema: 'montagio/install@0.1',
    mode: null,
    ports: { comfy: 8188, proxy: 8189, app: 3000 },
    gpuIndex: null,
    proxyUrl: null,
    extensions: null,
    extensionsAsked: null,
    vramProfile: null,
    proxyToken: null,
    stamps: {},
    weights: {},
  });
});

test('a state written before the extensions field reads them as null', () => {
  const path = join(dir, 'old.json');
  writeFileSync(path, JSON.stringify({ schema: 'montagio/install@0.1', mode: 'full', ports: { comfy: 8188, proxy: 8189, app: 3000 }, gpuIndex: 0, proxyUrl: null, stamps: {}, weights: {} }));
  expect(readState(path).extensions).toBeNull();
  expect(readState(path).extensionsAsked).toBeNull();
});

test('writeState then readState gives the same state, and leaves no temporary file', () => {
  const state = { ...emptyState(), mode: 'full' as const, gpuIndex: 1, stamps: { npm: 'abc' }, weights: { a: { sha256: 'f'.repeat(64), size: 3, mtimeMs: 12.5 } } };
  const path = join(dir, 'deeper', 'install-state.json');
  writeState(path, state);
  expect(readState(path)).toEqual(state);
  expect(readdirSync(join(dir, 'deeper'))).toEqual(['install-state.json']);
});

test('recordWeights keeps downloaded or present files whose sha256 is the lock one', () => {
  const sha = (c: string) => c.repeat(64);
  const lock: LockWeight[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, file: `${id}.safetensors`, url: 'u', sha256: sha(id), size: 10, folder: 'vae', extension: null }));
  const report = {
    weights: [
      { id: 'a', status: 'downloaded', sha256: sha('a') },
      { id: 'b', status: 'present', sha256: sha('b') },
      { id: 'c', status: 'failed', sha256: null },
      { id: 'd', status: 'present', sha256: sha('e') },
    ],
  };
  const state = recordWeights(emptyState(), report, lock, (id) => (id === 'b' ? { size: 10, mtimeMs: 7 } : { size: 10, mtimeMs: 5 }));
  expect(state.weights).toEqual({ a: { sha256: sha('a'), size: 10, mtimeMs: 5 }, b: { sha256: sha('b'), size: 10, mtimeMs: 7 } });
});
