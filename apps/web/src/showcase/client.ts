import type { ShowcaseData } from '@montagio/showcase/data';
import { createShowcaseRouter, type ShowcaseRouter } from './router';
import { MontageError, type Montage } from './types';
import { showcaseUrl } from './urls';

/**
 * The showcase's `fetch` for /api: it loads data.json once, then answers every
 * call from the in-page router. If data.json cannot be read (a bad deploy, a
 * network hiccup), every call answers 503 "showcase-unavailable" and the next
 * one tries again: the Studio shows its generic error, never a blank page.
 */
export function createShowcaseFetch(load: () => Promise<ShowcaseData>, montage: () => Promise<Montage>) {
  let router: Promise<ShowcaseRouter> | null = null;
  return async (path: string, init?: RequestInit): Promise<Response> => {
    router ??= Promise.all([load(), montage()]).then(([data, m]) => createShowcaseRouter(data, { montage: m }));
    let route: ShowcaseRouter;
    try {
      route = await router;
    } catch (error) {
      router = null;
      console.error('[montagio] the showcase data could not be loaded', error);
      return new Response(JSON.stringify({ error: 'showcase-unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return route(path, init);
  };
}

async function loadData(): Promise<ShowcaseData> {
  const res = await fetch(showcaseUrl('data.json'));
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  return (await res.json()) as ShowcaseData;
}

/** Until the montage lands, a film fails cleanly instead of hanging. */
const noMontage: Montage = {
  preload: () => undefined,
  assemble: async () => {
    throw new MontageError('ffmpeg-unavailable');
  },
};

export const showcaseFetch = createShowcaseFetch(loadData, async () => noMontage);
