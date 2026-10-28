import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeUploadedImage, probe, readImageTags } from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'montagio-image-upload-'));
const TIMEOUT = 60_000;

function source(path: string, _format: string, size = '64x32'): void {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-frames:v', '1', path]);
}

function exifOrientation(value: number): Buffer {
  const bytes = Buffer.alloc(34);
  bytes.writeUInt16BE(34, 0);
  bytes.write('Exif\0\0', 2, 'latin1');
  bytes.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 8);
  bytes.set([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01], 16);
  bytes.writeUInt16BE(value, 26);
  return bytes;
}

function rotatedJpeg(path: string): void {
  source(path, 'jpeg');
  const jpeg = readFileSync(path);
  const comment = Buffer.from('GPS=48.8566,2.3522', 'latin1');
  const segment = Buffer.alloc(4 + comment.length);
  segment.set([0xff, 0xfe], 0);
  segment.writeUInt16BE(comment.length + 2, 2);
  comment.copy(segment, 4);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), exifOrientation(6)]);
  writeFileSync(path, Buffer.concat([jpeg.subarray(0, 2), app1, segment, jpeg.subarray(2)]));
}

function oversizedPng(path: string): void {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=size=6401x6250', '-frames:v', '1', path]);
}

afterEach(() => {
  delete process.env.MONTAGIO_FFMPEG;
});

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

test('a rotated JPEG becomes upright PNG pixels without EXIF or comments', async () => {
  const input = join(dir, 'phone.jpg');
  const output = join(dir, 'phone.png');
  rotatedJpeg(input);
  await normalizeUploadedImage(input, output);
  expect(await probe(output)).toMatchObject({ width: 32, height: 64 });
  expect(await readImageTags(output)).toEqual({});
  const bytes = readFileSync(output);
  expect(bytes.equals(readFileSync(input))).toBe(false);
  expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
  expect(bytes.includes(Buffer.from('GPS='))).toBe(false);
}, TIMEOUT);

test.each(['png', 'webp'])('a %s upload is normalized to a readable PNG', async (format) => {
  const input = join(dir, `source.${format}`);
  const output = join(dir, `normalized-${format}.png`);
  source(input, format);
  await normalizeUploadedImage(input, output);
  expect(await probe(output)).toMatchObject({ width: 64, height: 32, codec: 'png' });
}, TIMEOUT);

test('an invalid image and excessive dimensions leave no output', async () => {
  const invalid = join(dir, 'invalid.png');
  const oversized = join(dir, 'oversized.png');
  writeFileSync(invalid, 'not an image');
  oversizedPng(oversized);
  await expect(normalizeUploadedImage(invalid, join(dir, 'invalid-out.png'))).rejects.toThrow();
  await expect(normalizeUploadedImage(oversized, join(dir, 'oversized-out.png'))).rejects.toThrow(/40,000,000|pixels/);
  expect(existsSync(join(dir, 'invalid-out.png'))).toBe(false);
  expect(existsSync(join(dir, 'oversized-out.png'))).toBe(false);
}, TIMEOUT);

test('a normalized PNG over 25 MiB leaves no output or temporary file', async () => {
  const input = join(dir, 'noise.png');
  const output = join(dir, 'noise-normalized.png');
  const raw = join(dir, 'noise.rgb');
  writeFileSync(raw, randomBytes(6000 * 4000 * 3));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '6000x4000', '-i', raw, '-frames:v', '1', input]);
  await expect(normalizeUploadedImage(input, output)).rejects.toThrow(/25 MiB/);
  expect(existsSync(output)).toBe(false);
  expect(existsSync(`${output}.tmp`)).toBe(false);
}, TIMEOUT);

test('FFmpeg failure leaves no output', async () => {
  const input = join(dir, 'valid.png');
  const output = join(dir, 'missing-ffmpeg.png');
  source(input, 'png');
  process.env.MONTAGIO_FFMPEG = 'ffmpeg-does-not-exist';
  await expect(normalizeUploadedImage(input, output)).rejects.toThrow(/not found/);
  expect(existsSync(output)).toBe(false);
}, TIMEOUT);
