import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetServicesForTests } from '@/server/services';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Fresh data directory and fresh in-memory services for every test. */
export function useTempData(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'montagio-web-'));
    process.env.MONTAGIO_ROOT = repoRoot;
    process.env.MONTAGIO_DATA = dir;
    process.env.MONTAGIO_BACKEND = 'demo';
    process.env.MONTAGIO_DEMO_DURATION_MS = '60000';
    resetServicesForTests();
  });
  return () => dir;
}

/** Minimal PNG: signature + IHDR chunk, enough for dimension sniffing. */
export function pngBytes(width: number, height: number, totalSize = 33): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(Math.max(totalSize, 33)));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export const pngFile = (width: number, height: number, name = 'photo.png') =>
  new File([pngBytes(width, height)], name, { type: 'image/png' });

export const bigPng = (size: number) => new File([pngBytes(1920, 1080, size)], 'big.png', { type: 'image/png' });

export function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set('image', file);
  return new Request('http://localhost/api/uploads', { method: 'POST', body: form });
}

export function generationRequest(body: unknown, idempotencyKey: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request('http://localhost/api/generations', { method: 'POST', headers, body: JSON.stringify(body) });
}

export const params = <T>(value: T) => ({ params: Promise.resolve(value) });

export function seedRecordFile(dataDir: string, record: Record<string, unknown>): void {
  const dir = join(dataDir, 'generations', String(record.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'record.json'), JSON.stringify(record));
}
