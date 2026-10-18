// A small static server for the showcase export, used by the showcase e2e and the
// post-build checks. It serves files the way a static host does: index.html for a
// folder, byte ranges (video seeking needs them), the export's 404.html, and an
// optional path prefix (a GitHub Pages project site lives under /<repo>/).
//
//   node scripts/serve-static.mjs <dir> <port> [--prefix /montagio]
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
};

/** The file a request path names inside `root`, or null when it leaves the folder. */
async function fileFor(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = resolve(root, `.${decoded}`);
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(root, rel) !== target) return null;
  try {
    const info = await stat(target);
    if (info.isFile()) return { path: target, size: info.size };
    if (info.isDirectory()) {
      const index = join(target, 'index.html');
      const indexInfo = await stat(index);
      if (indexInfo.isFile()) return { path: index, size: indexInfo.size };
    }
  } catch {
    // missing file or folder without index.html
  }
  return null;
}

async function notFound(root, res) {
  const page = await fileFor(root, '/404.html');
  res.writeHead(404, { 'content-type': page ? TYPES['.html'] : TYPES['.txt'] });
  if (page) createReadStream(page.path).pipe(res);
  else res.end('not found');
}

/** An http.Server serving `dir`; `prefix` ("/montagio") is stripped from every path and required. */
export function createStaticServer(dir, { prefix = '' } = {}) {
  const root = resolve(dir);
  return createServer(async (req, res) => {
    let pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (prefix) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return notFound(root, res);
      pathname = pathname.slice(prefix.length) || '/';
    }
    const file = await fileFor(root, pathname);
    if (!file) return notFound(root, res);

    const headers = {
      'content-type': TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : file.size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      start = Math.max(0, start);
      if (start > end) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${file.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${file.size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file.path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': file.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file.path).pipe(res);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, port, ...rest] = process.argv.slice(2);
  if (!dir || !port) {
    console.error('usage: node scripts/serve-static.mjs <dir> <port> [--prefix /x]');
    process.exit(2);
  }
  const at = rest.indexOf('--prefix');
  const prefix = at === -1 ? '' : (rest[at + 1] ?? '').replace(/\/+$/, '');
  createStaticServer(dir, { prefix }).listen(Number(port), () => {
    console.log(`serving ${resolve(dir)} on http://localhost:${port}${prefix}/`);
  });
}
