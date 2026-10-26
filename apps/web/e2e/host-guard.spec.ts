import { request as httpRequest } from 'node:http';
import { expect, test } from '@playwright/test';

/** The status of a GET sent with the Host and Origin a browser would send (Node's http keeps the Host it is given). */
function status(url: URL, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
}

test('the API and the files refuse a domain rebound to this machine, and answer the app itself', async ({ baseURL }) => {
  const at = (path: string) => new URL(path, baseURL);
  const port = at('/').port;
  expect(await status(at('/api/history'), { host: `rebind.example:${port}` })).toBe(403);
  expect(await status(at('/media/data/uploads/a.png'), { host: `rebind.example:${port}` })).toBe(403);
  expect(await status(at('/api/history'), { host: `localhost:${port}`, origin: 'https://evil.example' })).toBe(403);
  expect(await status(at('/api/history'), { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` })).toBe(200);
  // The pages too: a page takes Server Action and RSC requests, which a rebound domain could send.
  expect(await status(at('/'), { host: `rebind.example:${port}` })).toBe(403);
  expect(await status(at('/?_rsc=1'), { host: `rebind.example:${port}`, rsc: '1' })).toBe(403);
  expect(await status(at('/'), { host: `localhost:${port}` })).toBe(200);
});

/** The status and headers of a GET to the app itself. */
function answer(url: URL): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    httpRequest(url, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    })
      .on('error', reject)
      .end();
  });
}

test('no other site can frame the app or embed its files, and the image optimizer is closed', async ({ baseURL }) => {
  const at = (path: string) => new URL(path, baseURL);
  const page = await answer(at('/'));
  expect(page.headers['x-frame-options']).toBe('DENY');
  expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(page.headers['referrer-policy']).toBe('no-referrer');
  for (const path of ['/api/history', '/media/presets/previews/crash-push.jpg']) {
    const own = await answer(at(path));
    expect(own.status, path).toBe(200);
    expect(own.headers['cross-origin-resource-policy'], path).toBe('same-origin');
    expect(own.headers['x-content-type-options'], path).toBe('nosniff');
  }
  expect((await answer(at('/_next/image?url=%2Fmedia%2Fpresets%2Fpreviews%2Fcrash-push.jpg&w=64&q=75'))).status).not.toBe(200);
});
