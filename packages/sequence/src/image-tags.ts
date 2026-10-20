// The AI-generated mention for a still image: PNG text chunks, written without
// re-encoding the pixels (the image counterpart of tagClip).
import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { AI_IMAGE_METADATA, type VideoTags } from './tags';

export class ImageTagError extends Error {
  override name = 'ImageTagError';
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Text chunks the source may carry: replaced by ours, never kept beside them. */
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Chunk = { type: string; data: Buffer };

function readChunks(bytes: Buffer, source: string): Chunk[] {
  if (bytes.length < SIGNATURE.length || !bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new ImageTagError(`${source} is not a PNG image`);
  }
  const chunks: Chunk[] = [];
  for (let at = SIGNATURE.length; at < bytes.length; ) {
    if (at + 12 > bytes.length) throw new ImageTagError(`${source}: truncated PNG chunk`);
    const length = bytes.readUInt32BE(at);
    if (at + 12 + length > bytes.length) throw new ImageTagError(`${source}: truncated PNG chunk`);
    chunks.push({ type: bytes.toString('latin1', at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  if (chunks.at(-1)?.type !== 'IEND') throw new ImageTagError(`${source}: the PNG has no IEND chunk`);
  return chunks;
}

function encodeChunk({ type, data }: Chunk): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG's own keywords are capitalized: "comment" becomes "Comment". */
const keyword = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * Copy the PNG `input` to `out` with one tEXt chunk per tag (by default the
 * AI-generated mention), before IEND; the source's text chunks are dropped.
 */
export async function tagImage(input: string, out: string, tags: VideoTags = AI_IMAGE_METADATA): Promise<void> {
  const chunks = readChunks(await readFile(input), input).filter((chunk) => !TEXT_CHUNKS.has(chunk.type));
  const text = Object.entries(tags).map(([key, value]) => ({
    type: 'tEXt',
    data: Buffer.concat([Buffer.from(keyword(key), 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]),
  }));
  const end = chunks.length - 1;
  const bytes = Buffer.concat([SIGNATURE, ...[...chunks.slice(0, end), ...text, chunks[end]!].map(encodeChunk)]);
  const tmp = `${out}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, out);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** The tEXt chunks of a PNG, keyword → text. */
export async function readImageTags(path: string): Promise<Record<string, string>> {
  const tags: Record<string, string> = {};
  for (const chunk of readChunks(await readFile(path), path)) {
    if (chunk.type !== 'tEXt') continue;
    const zero = chunk.data.indexOf(0);
    if (zero > 0) tags[chunk.data.toString('latin1', 0, zero)] = chunk.data.toString('latin1', zero + 1);
  }
  return tags;
}
