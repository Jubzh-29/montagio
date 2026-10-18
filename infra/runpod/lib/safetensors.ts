/**
 * Read the header of a remote .safetensors file without downloading its
 * weights: an 8-byte little-endian length, then that many bytes of JSON that
 * name every tensor with its dtype and shape. Two HTTP Range requests; a
 * server that ignores Range is refused before more than a socket buffer of
 * the file has arrived.
 */

export type SafetensorsHeader = {
  headerBytes: number;
  metadata: Record<string, string> | null;
  tensors: Record<string, { dtype: string; shape: number[] }>;
};

/**
 * Keys ComfyUI's model detection reads for a Wan model (comfy/model_detection.py,
 * v0.41.0), with or without a prefix such as `model.diffusion_model.`.
 */
const DETECTION_KEYS = /(^|\.)(patch_embedding\.weight|head\.head\.weight|head\.modulation|img_emb\.proj\.0\.bias|control_adapter\.[^.]+\.weight|ref_conv\.weight|vace_patch_embedding\.weight)$/;

/** A few lines on a header: tensor and parameter counts, dtypes, and the shapes model detection reads. */
export function summarizeHeader(header: SafetensorsHeader): string[] {
  const entries = Object.entries(header.tensors);
  const parameters = entries.reduce((sum, [, t]) => sum + t.shape.reduce((n, d) => n * d, 1), 0);
  const dtypes = new Map<string, number>();
  for (const [, t] of entries) dtypes.set(t.dtype, (dtypes.get(t.dtype) ?? 0) + 1);
  return [
    `${entries.length} tensors, ${parameters.toLocaleString('en-US')} parameters`,
    `dtypes: ${[...dtypes].sort().map(([dtype, n]) => `${dtype} × ${n}`).join(', ')}`,
    ...entries
      .filter(([name]) => DETECTION_KEYS.test(name))
      .map(([name, t]) => `${name}: ${t.dtype} [${t.shape.join(', ')}]`),
  ];
}

/** The format caps the header at 100 MB. */
const MAX_HEADER_BYTES = 100 * 1024 * 1024;

async function readRange(url: string, start: number, end: number, headers: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers: { ...headers, range: `bytes=${start}-${end}` } });
  if (res.status !== 206) {
    await res.body?.cancel();
    if (res.ok) throw new Error(`${url}: the server ignored the Range request (HTTP ${res.status}); refusing to download the whole file`);
    throw new Error(`GET ${url} (bytes ${start}-${end}) → HTTP ${res.status}`);
  }
  const want = end - start + 1;
  const chunks: Buffer[] = [];
  let got = 0;
  const reader = res.body!.getReader();
  while (got < want) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    got += value.length;
  }
  await reader.cancel();
  const bytes = Buffer.concat(chunks).subarray(0, want);
  if (bytes.length < want) throw new Error(`${url}: got ${bytes.length} bytes of the range ${start}-${end}, expected ${want}`);
  return bytes;
}

export async function readSafetensorsHeader(
  url: string,
  opts: { headers?: Record<string, string>; maxHeaderBytes?: number } = {},
): Promise<SafetensorsHeader> {
  const headers = opts.headers ?? {};
  const max = opts.maxHeaderBytes ?? MAX_HEADER_BYTES;
  const length = (await readRange(url, 0, 7, headers)).readBigUInt64LE(0);
  if (length === 0n || length > BigInt(max)) {
    throw new Error(`${url}: header of ${length} bytes is outside the limit of 1..${max} bytes; not a safetensors file?`);
  }
  const headerBytes = Number(length);
  const text = (await readRange(url, 8, 8 + headerBytes - 1, headers)).toString('utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${url}: the safetensors header is not JSON (${(error as Error).message})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${url}: the safetensors header is not a JSON object`);
  let metadata: Record<string, string> | null = null;
  const tensors: SafetensorsHeader['tensors'] = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (name === '__metadata__') {
      metadata = value as Record<string, string>;
      continue;
    }
    const { dtype, shape } = value as { dtype: string; shape: number[] };
    tensors[name] = { dtype, shape };
  }
  return { headerBytes, metadata, tensors };
}
