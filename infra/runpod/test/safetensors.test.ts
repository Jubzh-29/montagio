import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readSafetensorsHeader, summarizeHeader } from '../lib/safetensors';

/** A small .safetensors file: 8-byte little-endian header length, JSON header, tensor bytes. */
function safetensors(header: unknown, dataBytes = 28, rawHeader?: string): Buffer {
  const json = Buffer.from(rawHeader ?? JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, json, Buffer.alloc(dataBytes, 7)]);
}

const HEADER = {
  __metadata__: { format: 'pt' },
  'patch_embedding.weight': { dtype: 'F16', shape: [2, 3], data_offsets: [0, 12] },
  'head.head.weight': { dtype: 'F32', shape: [4], data_offsets: [12, 28] },
};

type Mode = 'range' | 'ignore-range';
let server: Server;
let base: string;
let file: Buffer;
let mode: Mode;
let ranges: (string | undefined)[];
let sentWhenIgnoring: number;

function sendIgnoringRange(res: ServerResponse) {
  // Answer 200 with the whole file and then far more: a real weight file is gigabytes.
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(64 * 1024 ** 2) });
  const chunk = Buffer.alloc(64 * 1024, 1);
  let left = 64 * 1024 ** 2;
  const pump = () => {
    while (left > 0) {
      const part = left === 64 * 1024 ** 2 ? file : chunk;
      left -= part.length;
      sentWhenIgnoring += part.length;
      if (!res.write(part)) return void res.once('drain', pump);
    }
    res.end();
  };
  res.on('close', () => (left = 0));
  pump();
}

beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range);
    if (mode === 'ignore-range') return sendIgnoringRange(res);
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (!match) return void res.writeHead(200).end(file);
    const [start, end] = [Number(match[1]), Math.min(Number(match[2]), file.length - 1)];
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${file.length}`, 'content-length': String(end - start + 1) });
    res.end(file.subarray(start, end + 1));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.safetensors`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  mode = 'range';
  ranges = [];
  sentWhenIgnoring = 0;
  file = safetensors(HEADER);
});

test('reads the tensors and the metadata with two Range requests', async () => {
  const header = await readSafetensorsHeader(base);
  const length = file.readUInt32LE(0);
  expect(ranges).toEqual(['bytes=0-7', `bytes=8-${8 + length - 1}`]);
  expect(header.headerBytes).toBe(length);
  expect(header.metadata).toEqual({ format: 'pt' });
  expect(header.tensors).toEqual({
    'patch_embedding.weight': { dtype: 'F16', shape: [2, 3] },
    'head.head.weight': { dtype: 'F32', shape: [4] },
  });
});

test('refuses a server that ignores Range and closes the body', async () => {
  mode = 'ignore-range';
  await expect(readSafetensorsHeader(base)).rejects.toThrow(/ignored the Range request/);
  await new Promise((done) => setTimeout(done, 200));
  // what sat in the socket buffers at most, far from the 64 MiB the server meant to send
  expect(sentWhenIgnoring).toBeLessThan(8 * 1024 ** 2);
  expect(ranges).toHaveLength(1);
});

test('refuses a header longer than maxHeaderBytes before asking for it', async () => {
  file = safetensors(HEADER);
  file.writeBigUInt64LE(10n ** 9n, 0);
  await expect(readSafetensorsHeader(base)).rejects.toThrow(/header of 1000000000 bytes.*limit/);
  expect(ranges).toHaveLength(1);
});

test('refuses a header that is not JSON', async () => {
  file = safetensors(null, 28, '{"a": not json}');
  await expect(readSafetensorsHeader(base)).rejects.toThrow(/not JSON/);
});

test('summarizeHeader counts tensors and parameters and shows the keys model detection reads', () => {
  const lines = summarizeHeader({
    headerBytes: 100,
    metadata: null,
    tensors: {
      'patch_embedding.weight': { dtype: 'BF16', shape: [3072, 48, 1, 2, 2] },
      'control_adapter.conv.weight': { dtype: 'BF16', shape: [5120, 384, 2, 2] },
      'blocks.0.ffn.0.weight': { dtype: 'F8_E4M3', shape: [14336, 3072] },
      'model.diffusion_model.head.head.weight': { dtype: 'BF16', shape: [192, 3072] },
    },
  });
  const parameters = 3072 * 48 * 4 + 5120 * 384 * 4 + 14336 * 3072 + 192 * 3072;
  expect(lines[0]).toBe(`4 tensors, ${parameters.toLocaleString('en-US')} parameters`);
  expect(lines).toContain('dtypes: BF16 × 3, F8_E4M3 × 1');
  expect(lines).toContain('patch_embedding.weight: BF16 [3072, 48, 1, 2, 2]');
  expect(lines).toContain('control_adapter.conv.weight: BF16 [5120, 384, 2, 2]');
  // a key prefix such as model.diffusion_model. is shown as it is
  expect(lines).toContain('model.diffusion_model.head.head.weight: BF16 [192, 3072]');
  expect(lines.some((line) => line.startsWith('blocks.0.ffn.0.weight'))).toBe(false);
});
