import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { getEnv } from '@/server/env';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

/** Only these top-level folders are ever served. */
function baseFor(prefix: string | undefined): string | null {
  const { root, data } = getEnv();
  if (prefix === 'data') return data;
  if (prefix === 'demo-assets') return join(root, 'demo-assets');
  if (prefix === 'presets') return join(root, 'presets', 'previews');
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [prefix, ...rest] = (await params).path;
  let base = baseFor(prefix);
  // Preset previews are addressed as /media/presets/previews/<file>.
  if (prefix === 'presets') {
    if (rest[0] !== 'previews') base = null;
    rest.shift();
  }
  if (!base || rest.length === 0 || rest.some((segment) => segment === '..' || segment.includes('\\') || segment.includes(':'))) {
    return Response.json({ error: 'bad-path' }, { status: 400 });
  }
  const file = resolve(base, ...rest);
  const rel = relative(base, file);
  if (!rel || rel.startsWith('..')) return Response.json({ error: 'bad-path' }, { status: 400 });

  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    return Response.json({ error: 'not-found' }, { status: 404 });
  }

  const headers = new Headers({
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  });
  const bytes = await readFile(file);

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      headers.set('content-range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(bytes, { headers });
}
