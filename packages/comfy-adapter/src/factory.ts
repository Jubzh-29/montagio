import { join } from 'node:path';
import type { GenerationBackend } from './backend';
import { DemoBackend } from './demo';

/**
 * Build the backend selected by MONTAGIO_BACKEND (default "demo").
 * "local" and "hosted" run the same open-weights workflows through the Comfy SDK
 * and arrive with plan 2.
 */
export function createBackend(env: Record<string, string | undefined>): GenerationBackend {
  const kind = env.MONTAGIO_BACKEND ?? 'demo';
  switch (kind) {
    case 'demo':
      return new DemoBackend({
        clipsDir: env.MONTAGIO_DEMO_CLIPS ?? join(env.MONTAGIO_ROOT ?? process.cwd(), 'demo-assets', 'clips'),
        durationMs: Number(env.MONTAGIO_DEMO_DURATION_MS ?? 6000),
      });
    case 'local':
    case 'hosted':
      throw new Error(`Backend "${kind}" arrives in plan 2 (after GPU session S1)`);
    default:
      throw new Error(`Unknown backend "${kind}" (expected demo, local or hosted)`);
  }
}
