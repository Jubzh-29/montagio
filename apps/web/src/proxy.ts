import type { NextRequest } from 'next/server';

/**
 * The app answers only its own address: the API, the files and the pages, which take Server Action and
 * RSC requests too (an exploit of their decoding needs no route of ours). A site the visitor has open
 * elsewhere can point its domain at 127.0.0.1 (DNS rebinding): the browser then treats it as this site,
 * but still names that domain in Host, and in the Origin Next compares Host with. Allowed: localhost,
 * 127.0.0.1 and [::1] on the port served, and the hosts of MONTAGIO_ALLOWED_HOSTS
 * ("192.168.1.20:8080,studio.example"; a name without a port takes any port). An Origin, when the
 * browser sends one, must be allowed too. Only the build's scripts and styles (/_next/static) are left
 * out: the same for everyone. The showcase is a static export: its pageExtensions leave this file out,
 * and no server runs.
 */
export const config = { matcher: ['/((?!_next/static/).*)'] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

type Host = { name: string; port: string };

/** "name:port" as a URL reads it: lower case, IPv6 in brackets, no port for the scheme's own. */
function parseHost(text: string): Host | null {
  if (!text || /[/\\@?#\s]/.test(text)) return null;
  try {
    const url = new URL(`http://${text}`);
    return { name: url.hostname, port: url.port };
  } catch {
    return null;
  }
}

/** The hosts MONTAGIO_ALLOWED_HOSTS lists, read on every call; a pasted URL keeps its host. */
function listedHosts(): (Host | { name: string; port: null })[] {
  return (process.env.MONTAGIO_ALLOWED_HOSTS ?? '').split(',').flatMap((raw) => {
    const entry = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
    const host = parseHost(entry);
    if (!host) return [];
    return [/:\d+$/.test(entry) ? host : { name: host.name, port: null }];
  });
}

function allowed(text: string | null, servedPort: string): boolean {
  const host = text === null ? null : parseHost(text);
  if (!host) return false;
  if (LOOPBACK.has(host.name) && host.port === servedPort) return true;
  return listedHosts().some((listed) => listed.name === host.name && (listed.port === null || listed.port === host.port));
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    // "null": a sandboxed frame, or a page that hides where it is.
    return null;
  }
}

// Each refused address is logged once, so a page that keeps trying does not flood the log.
const logged = new Set<string>();

export function proxy(request: NextRequest): Response | undefined {
  // Next builds the request URL from the port it serves, not from the Host header.
  const servedPort = request.nextUrl.port;
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (allowed(host, servedPort) && (origin === null || allowed(originHost(origin), servedPort))) return undefined;
  const key = `${host} ${origin}`;
  if (!logged.has(key) && logged.size < 50) {
    logged.add(key);
    console.warn(`[montagio] a request for host ${host ?? '(none)'}${origin ? ` from ${origin}` : ''} refused: list the address in MONTAGIO_ALLOWED_HOSTS to open the app there`);
  }
  return Response.json({ error: 'host-not-allowed' }, { status: 403 });
}
