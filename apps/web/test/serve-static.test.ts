import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, listenStatic } from '../scripts/serve-static.mjs';

let dir = '';
let server: Server | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'montagio-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>root</title>');
  writeFileSync(join(dir, '404.html'), '<!doctype html><title>missing</title>');
  writeFileSync(join(dir, 'a.wasm'), new Uint8Array([0, 97, 115, 109]));
  writeFileSync(join(dir, 'v.mp4'), new Uint8Array(100).map((_, i) => i));
  mkdirSync(join(dir, 'open-stack'));
  writeFileSync(join(dir, 'open-stack', 'index.html'), '<!doctype html><title>open stack</title>');
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

async function start(opts: { prefix?: string } = {}): Promise<string> {
  server = createStaticServer(dir, opts) as Server;
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

test('serves index.html for a folder and the right MIME types', async () => {
  const base = await start();
  const root = await fetch(`${base}/`);
  expect(root.status).toBe(200);
  expect(root.headers.get('content-type')).toMatch(/^text\/html/);
  expect(await root.text()).toContain('root');
  expect((await fetch(`${base}/open-stack/`)).status).toBe(200);
  expect((await fetch(`${base}/a.wasm`)).headers.get('content-type')).toBe('application/wasm');
  expect((await fetch(`${base}/v.mp4`)).headers.get('content-type')).toBe('video/mp4');
});

test('answers a byte range with 206', async () => {
  const base = await start();
  const res = await fetch(`${base}/v.mp4`, { headers: { range: 'bytes=0-9' } });
  expect(res.status).toBe(206);
  expect(res.headers.get('content-range')).toBe('bytes 0-9/100');
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(10).map((_, i) => i));
});

/** A GET sent with the path exactly as written: fetch would normalize "..". */
function rawGet(base: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('refuses paths outside the folder', async () => {
  const outside = join(dir, '..', `${dir.split(/[\\/]/).pop()}-outside.txt`);
  writeFileSync(outside, 'secret');
  try {
    const base = await start();
    const name = outside.split(/[\\/]/).pop();
    for (const path of [`/..%2f${name}`, `/..%5c${name}`]) {
      const res = await rawGet(base, path);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('secret');
    }
  } finally {
    rmSync(outside, { force: true });
  }
});

test('answers 404 with the export 404 page', async () => {
  const base = await start();
  const res = await fetch(`${base}/nowhere/`);
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('missing');
});

test('serves under a prefix', async () => {
  const base = await start({ prefix: '/montagio' });
  const res = await fetch(`${base}/montagio/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('root');
  expect((await fetch(`${base}/`)).status).toBe(404);
});

test('the command-line server listens on the loopback interface only', async () => {
  server = (await listenStatic(dir, 0)) as Server;
  const address = server.address() as AddressInfo;
  expect(address.address).toBe('127.0.0.1');
  expect((await fetch(`http://127.0.0.1:${address.port}/`)).status).toBe(200);
});
