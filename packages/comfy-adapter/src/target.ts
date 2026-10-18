/** Hosts run by Comfy (Cloud, the Router API, serverless deployments): never a target of Montagio. */
const COMFY_HOSTED = [/(^|\.)comfy\.org$/i, /(^|\.)comfy\.app$/i];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_REDIRECTS = 5;

/**
 * Validate the SDK base URL. `@comfyorg/sdk` reads COMFY_BASE_URL and silently
 * targets Comfy Cloud when it is blank, so Montagio always passes an explicit
 * self-hosted URL and refuses every Comfy-hosted surface.
 */
export function assertLocalBaseUrl(raw: string): { url: URL; base: string; loopback: boolean } {
  const value = raw.trim();
  if (!value) throw new Error('the SDK base URL must be explicit (a blank value means Comfy Cloud to @comfyorg/sdk)');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid SDK base URL ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`SDK base URL must be http(s), got ${url.protocol}`);
  if (url.search || url.hash || /[?#]/.test(value)) throw new Error('SDK base URL must have no query or fragment');
  if (COMFY_HOSTED.some((host) => host.test(url.hostname))) {
    throw new Error(`refused: ${url.hostname} is a Comfy-hosted surface; Montagio only talks to a self-hosted comfy-api-proxy`);
  }
  // The SDK appends API paths to this string, so it must not end with a slash.
  return { url, base: value.replace(/\/+$/, ''), loopback: LOOPBACK.has(url.hostname) };
}

/**
 * A `fetch` for the SDK that refuses every request outside the base URL's
 * origin, so nothing can reach Comfy Cloud or the Router even if the SDK or a
 * server-provided link points elsewhere.
 */
export function guardFetch(base: URL, inner: typeof fetch = fetch): typeof fetch {
  const guarded = async (input: RequestInfo | URL, init: RequestInit | undefined, hops: number): Promise<Response> => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== base.origin) throw new Error(`refused request to ${target.origin}: only ${base.origin} is allowed`);
    // A caller that handles redirects itself gets them as they are.
    if (init?.redirect === 'manual' || init?.redirect === 'error') return inner(input, init);
    // Otherwise the redirects are followed here, not by fetch, which would send the
    // request (and a 307/308's body) to the new location before anyone could look at it.
    const response = await inner(input, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status > 399 || !location) return response;
    await response.body?.cancel();
    if (hops >= MAX_REDIRECTS) throw new Error(`refused: more than ${MAX_REDIRECTS} redirects from ${base.origin}`);
    // fetch's own rule: 303, and 301/302 after a POST, go on as a GET without a body.
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const asGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST');
    return guarded(new URL(location, target), asGet ? { ...init, method: 'GET', body: undefined } : init, hops + 1);
  };
  return ((input: RequestInfo | URL, init?: RequestInit) => guarded(input, init, 0)) as typeof fetch;
}
