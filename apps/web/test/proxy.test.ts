import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { config, proxy } from '@/proxy';

// The URL is the server's own (Next builds it from the port it serves); Host and Origin are what the browser sent.
const call = (host: string | null, headers: Record<string, string> = {}, path = '/api/history') =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { ...(host === null ? {} : { host }), ...headers } }));

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MONTAGIO_ALLOWED_HOSTS;
  delete process.env.MONTAGIO_ALLOWED_HOSTS;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (saved === undefined) delete process.env.MONTAGIO_ALLOWED_HOSTS;
  else process.env.MONTAGIO_ALLOWED_HOSTS = saved;
  vi.restoreAllMocks();
});

test('the app on this machine passes: localhost, 127.0.0.1 and [::1] on the port it serves', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LocalHost:3000']) expect(call(host)).toBeUndefined();
  expect(call('localhost:3000', { origin: 'http://localhost:3000' })).toBeUndefined();
  expect(call('127.0.0.1:3000', { origin: 'http://127.0.0.1:3000' }, '/media/data/uploads/a.png')).toBeUndefined();
});

test('a domain rebound to 127.0.0.1 is refused, on the API and on the files', async () => {
  const res = call('rebind.example:3000');
  expect(res?.status).toBe(403);
  expect(await res?.json()).toEqual({ error: 'host-not-allowed' });
  expect(call('rebind.example:3000', {}, '/media/data/uploads/a.png')?.status).toBe(403);
  // Another port, 0.0.0.0 (which some systems route to this machine), a forged or missing Host.
  for (const host of ['localhost:8080', 'localhost', '0.0.0.0:3000', 'localhost.:3000', 'evil.example@localhost:3000', '']) expect(call(host)?.status).toBe(403);
  expect(call(null)?.status).toBe(403);
});

test('a page of another site is refused by its Origin, even with the right Host', () => {
  for (const origin of ['https://evil.example', 'http://localhost:8080', 'null']) expect(call('localhost:3000', { origin })?.status).toBe(403);
});

test('MONTAGIO_ALLOWED_HOSTS opens the app to an address of the local network or a domain', () => {
  process.env.MONTAGIO_ALLOWED_HOSTS = '192.168.1.20:3000, montagio.Home.Example ,https://studio.example/';
  expect(call('192.168.1.20:3000', { origin: 'http://192.168.1.20:3000' })).toBeUndefined();
  // A listed port is the only one; a name without a port, behind a reverse proxy, takes any port.
  expect(call('192.168.1.20:4000')?.status).toBe(403);
  expect(call('montagio.home.example')).toBeUndefined();
  expect(call('montagio.home.example:8443', { origin: 'https://montagio.home.example:8443' })).toBeUndefined();
  expect(call('studio.example', { origin: 'https://studio.example' })).toBeUndefined();
  // The loopback names stay allowed, the rest stays refused.
  expect(call('localhost:3000')).toBeUndefined();
  expect(call('rebind.example:3000')?.status).toBe(403);
  expect(call('192.168.1.20:3000', { origin: 'https://evil.example' })?.status).toBe(403);
});

test('a refusal names the variable in the log, once per host', () => {
  call('lan-box:3000');
  call('lan-box:3000');
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('MONTAGIO_ALLOWED_HOSTS');
});

test('the guard runs on the API and the files, not on the pages', () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  expect(matches('/api/history')).toBe(true);
  expect(matches('/api/uploads/video/sample')).toBe(true);
  expect(matches('/media/data/uploads/a.png')).toBe(true);
  expect(matches('/')).toBe(false);
  expect(matches('/_next/static/chunks/app.js')).toBe(false);
});
