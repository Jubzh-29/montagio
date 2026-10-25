import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { getEnv } from '@/server/env';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

/**
 * Next decodes %2F inside catch-all segments, so a single segment can carry
 * "//host/share/..." (a Windows UNC path) or "/etc/...". Each segment must be a
 * plain file or folder name: not empty, not "." or "..", and free of
 * separators, drive colons and NUL.
 */
function isSafeSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !/[/\\:\u0000]/.test(segment);
}

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
  // Preset previews are addressed as /media/presets/previews/<file>; those of the effects, the hooks,
  // the extensions' examples and the motion library as /media/presets/{effects,transitions,extensions,motions}/previews/<file>.
  if (prefix === 'presets') {
    const kind = rest[0] === 'effects' || rest[0] === 'transitions' || rest[0] === 'extensions' || rest[0] === 'motions' ? rest.shift() : undefined;
    if (rest[0] !== 'previews') base = null;
    else if (kind && base) base = join(getEnv().root, 'presets', kind, 'previews');
    rest.shift();
  }
  if (!base || rest.length === 0 || !rest.every(isSafeSegment)) {
    return Response.json({ error: 'bad-path' }, { status: 400 });
  }
  const file = resolve(base, ...rest);
  const rel = relative(base, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return Response.json({ error: 'bad-path' }, { status: 400 });

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
