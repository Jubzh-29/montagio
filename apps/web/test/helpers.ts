import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetServicesForTests } from '@/server/services';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Fresh data directory and fresh in-memory services for every test. */
export function setupTempData(): () => string {
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

/** Minimal JPEG: SOI + APP1 Exif (orientation) + SOF0 (size) + EOI. */
export function jpegWithOrientation(width: number, height: number, orientation: number, name = 'phone.jpg'): File {
  const bytes = new Uint8Array(new ArrayBuffer(59));
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22], 0); // SOI, APP1 (length 34)
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  bytes.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 12); // TIFF, big-endian, IFD0 at 8
  bytes.set([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01], 20); // 1 entry: Orientation, SHORT x1
  view.setUint16(30, orientation);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 38); // SOF0 (length 17), 8-bit
  view.setUint16(43, height);
  view.setUint16(45, width);
  bytes.set([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], 47);
  bytes.set([0xff, 0xd9], 57); // EOI
  return new File([bytes], name, { type: 'image/jpeg' });
}
