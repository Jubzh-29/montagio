import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetServicesForTests } from '@/server/services';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Fresh data directory and fresh in-memory services for every test; the directory goes once the test is over. */
export function setupTempData(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'montagio-web-'));
    process.env.MONTAGIO_ROOT = repoRoot;
    process.env.MONTAGIO_DATA = dir;
    process.env.MONTAGIO_BACKEND = 'demo';
    process.env.MONTAGIO_PROXY_TOKEN = 'test-proxy-token';
    process.env.MONTAGIO_DEMO_DURATION_MS = '60000';
    // The pre-rendered files of demo-assets/, not a render of each test photo (demo-render.test.ts turns it on).
    process.env.MONTAGIO_DEMO_RENDER = 'off';
    resetServicesForTests();
  });
  // Retries: on Windows a clip FFmpeg just closed can stay locked for a moment.
  afterEach(() => {
    delete process.env.MONTAGIO_PROXY_TOKEN;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return () => dir;
}

/**
 * Remove every GPU date from a copy of the library under `root`, as it was before GPU session S2: the
 * extensions of registry/extensions.yaml back to null, the effect and hook presets without gpu_validated.
 * Tests of the cut rule start from there, then date what they need.
 */
export function undateLibrary(root: string): void {
  const config = join(root, 'registry', 'extensions.yaml');
  writeFileSync(config, readFileSync(config, 'utf8').replace(/gpu_validated: \d{4}-\d{2}-\d{2}/g, 'gpu_validated: null'));
  for (const folder of ['effects', 'transitions']) {
    for (const name of readdirSync(join(root, 'presets', folder)).filter((file) => file.endsWith('.yaml'))) {
      const path = join(root, 'presets', folder, name);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/^gpu_validated: .*\n?/m, ''));
    }
  }
}

/** A valid RGBA PNG, padded to a requested size when a size-limit test needs one. */
export function pngBytes(width: number, height: number, totalSize = 33): Uint8Array<ArrayBuffer> {
  const crc = (bytes: Buffer): number => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value ^ byte) & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  if (totalSize <= png.length + 20) return png;
  const padding = Buffer.alloc(totalSize - png.length - 12);
  padding.write('Comment\0', 0, 'latin1');
  return Buffer.concat([png.subarray(0, -12), chunk('tEXt', padding), png.subarray(-12)]);
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

/** A real JPEG with an EXIF orientation tag, encoded by FFmpeg. */
export function jpegWithOrientation(width: number, height: number, orientation: number, name = 'phone.jpg'): File {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-jpeg-'));
  const path = join(dir, 'photo.jpg');
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}`, '-frames:v', '1', path]);
    const jpeg = readFileSync(path);
    const app1 = new Uint8Array(new ArrayBuffer(36));
    app1.set([0xff, 0xe1, 0x00, 0x22], 0);
    app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
    app1.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 10);
    app1.set([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01], 18);
    new DataView(app1.buffer).setUint16(28, orientation);
    return new File([Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)])], name, { type: 'image/jpeg' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
