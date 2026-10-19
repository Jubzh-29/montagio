/**
 * The static showcase (the free demo link) has no server: it is built with
 * NEXT_PUBLIC_MONTAGIO_MODE=showcase, and its pages call an in-page router
 * instead of /api (src/showcase/router.ts). Everywhere else, apiFetch is fetch.
 */
export const IS_SHOWCASE = process.env.NEXT_PUBLIC_MONTAGIO_MODE === 'showcase';

/** fetch for the app's own /api routes. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!IS_SHOWCASE) return fetch(path, init);
  return import('@/showcase/client').then(({ showcaseFetch }) => showcaseFetch(path, init));
}

/** The JSON of a successful answer; an error answer (4xx, 5xx) throws instead of passing its body off as data. */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url || 'request'}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
