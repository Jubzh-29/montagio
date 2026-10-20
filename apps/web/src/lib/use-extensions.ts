'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { ExtensionsInfo } from './api-types';

// One fetch of /api/extensions per page, shared by the header and the Studio.
let current: ExtensionsInfo | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  pending ??= apiFetch('/api/extensions')
    .then((res) => (res.ok ? (res.json() as Promise<ExtensionsInfo>) : null))
    .then((info) => {
      current = info;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined);
}

/** Ask again: after ComfyUI refused an extension, the server hides it. */
export function refreshExtensions(): void {
  pending = null;
  load();
}

/** What the Studio may show (GET /api/extensions), or null while it loads or if it cannot be read. */
export function useExtensions(): ExtensionsInfo | null {
  const [info, setInfo] = useState<ExtensionsInfo | null>(current);
  useEffect(() => {
    const listener = () => setInfo(current);
    listeners.add(listener);
    load();
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return info;
}
