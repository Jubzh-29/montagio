import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { AI_IMAGE_METADATA, ImageTagError, readImageTags, RECIPE_TAG, tagImage } from '../src/index';

// A real 1x1 RGBA PNG (signature, IHDR, IDAT, IEND).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

type Chunk = { type: string; data: Buffer; crc: number };

function chunksOf(bytes: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length), crc: bytes.readUInt32BE(at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'montagio-image-tags-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('a PNG export writes its recipe under the Montagio key', async () => {
  const input = join(dir, 'in.png');
  const out = join(dir, 'recipe.png');
  writeFileSync(input, PNG_1X1);
  await tagImage(input, out, { [RECIPE_TAG.image]: '{"schema":"montagio/recipe@1"}' });
  expect(await readImageTags(out)).toEqual({ 'Montagio-Recipe': '{"schema":"montagio/recipe@1"}' });
});

test('a tagged PNG reads back AI-generated, its pixels untouched', async () => {
  const input = join(dir, 'in.png');
  const out = join(dir, 'out.png');
  writeFileSync(input, PNG_1X1);
  await tagImage(input, out);
  expect(await readImageTags(out)).toEqual({ Comment: AI_IMAGE_METADATA.comment, Description: AI_IMAGE_METADATA.description });
  const before = chunksOf(PNG_1X1).filter((chunk) => chunk.type !== 'tEXt');
  const after = chunksOf(readFileSync(out)).filter((chunk) => chunk.type !== 'tEXt');
  expect(after.map((chunk) => [chunk.type, chunk.data.toString('hex')])).toEqual(before.map((chunk) => [chunk.type, chunk.data.toString('hex')]));
  expect(chunksOf(readFileSync(out)).at(-1)!.type).toBe('IEND');
});

test('tagging twice keeps one Comment and one Description', async () => {
  const input = join(dir, 'in.png');
  writeFileSync(input, PNG_1X1);
  await tagImage(input, join(dir, 'once.png'));
  await tagImage(join(dir, 'once.png'), join(dir, 'twice.png'));
  const texts = chunksOf(readFileSync(join(dir, 'twice.png'))).filter((chunk) => chunk.type === 'tEXt');
  expect(texts.map((chunk) => chunk.data.toString('latin1').split('\0')[0]).sort()).toEqual(['Comment', 'Description']);
});

test('the CRC of each written chunk is right', async () => {
  const input = join(dir, 'in.png');
  writeFileSync(input, PNG_1X1);
  await tagImage(input, join(dir, 'out.png'));
  for (const chunk of chunksOf(readFileSync(join(dir, 'out.png')))) {
    expect(chunk.crc).toBe(crc32(Buffer.concat([Buffer.from(chunk.type, 'latin1'), chunk.data])) >>> 0);
  }
});

test('a JPEG is refused with ImageTagError', async () => {
  const input = join(dir, 'in.jpg');
  writeFileSync(input, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]));
  await expect(tagImage(input, join(dir, 'out.png'))).rejects.toBeInstanceOf(ImageTagError);
});

test("an image handed out keeps no EXIF: a camera's eXIf chunk (its GPS position among it) is dropped", async () => {
  const exif = Buffer.from('MM\0*\0\0\0\x08GPS 48.8566 N 2.3522 E', 'latin1');
  const head = Buffer.alloc(8);
  head.writeUInt32BE(exif.length, 0);
  head.write('eXIf', 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), exif])) >>> 0, 0);
  const iend = PNG_1X1.length - 12;
  const input = join(dir, 'gps.png');
  writeFileSync(input, Buffer.concat([PNG_1X1.subarray(0, iend), head, exif, crc, PNG_1X1.subarray(iend)]));
  expect(chunksOf(readFileSync(input)).map((chunk) => chunk.type)).toContain('eXIf');
  await tagImage(input, join(dir, 'out.png'));
  expect(chunksOf(readFileSync(join(dir, 'out.png'))).map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'tEXt', 'tEXt', 'IEND']);
});
