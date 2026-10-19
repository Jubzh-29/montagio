'use client';

import { useEffect, useState } from 'react';
import { apiFetch, IS_SHOWCASE } from './api';
import type { ShowcaseInfo } from './api-types';

/** What the static showcase offers (samples, model, capabilities), or null outside the showcase and while it loads. */
export function useShowcase(): ShowcaseInfo | null {
  const [info, setInfo] = useState<ShowcaseInfo | null>(null);
  useEffect(() => {
    if (!IS_SHOWCASE) return;
    let alive = true;
    apiFetch('/api/showcase')
      .then((res) => (res.ok ? (res.json() as Promise<ShowcaseInfo>) : null))
      .then((value) => {
        if (alive && value) setInfo(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
