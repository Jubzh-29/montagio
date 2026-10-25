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
});
