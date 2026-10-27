'use client';

import { useEffect, useState } from 'react';
import { apiFetch, jsonOrThrow } from './api';
import type { OpenStackReport } from './api-types';

type StackModel = { id: string; name: string; license: string };

// One read of the open-stack report per page load, shared by every caption (the header's badge reads it too).
let report: Promise<OpenStackReport | null> | null = null;

/**
 * The model that made a result, as the Open Stack page lists it (name, licence), for the result's AI-generated caption
 * and its link to the model's line; null until the report answers, or for a model it does not list.
 */
export function useStackModel(modelId: string | undefined): StackModel | null {
  const [model, setModel] = useState<StackModel | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let alive = true;
    report ??= apiFetch('/api/open-stack')
      .then((res) => jsonOrThrow<OpenStackReport>(res))
      .catch(() => {
        report = null;
        return null;
      });
    void report.then((got) => {
      const found = got?.models.find((entry) => entry.id === modelId);
      if (alive) setModel(found ? { id: found.id, name: found.name, license: found.license } : null);
    });
    return () => {
      alive = false;
    };
  }, [modelId]);
  return model?.id === modelId ? model : null;
}
