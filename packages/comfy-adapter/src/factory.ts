import { join } from 'node:path';
import type { GenerationBackend } from './backend';
import { ComfyBackend } from './comfy';
import { DemoBackend, type DemoRender } from './demo';
import { assertLocalBaseUrl } from './target';

/**
 * Build the backend selected by MONTAGIO_BACKEND (default "demo").
 * "local" runs the open-weights workflows on a ComfyUI behind comfy-api-proxy, at the
 * explicit COMFY_BASE_URL; "hosted" comes with the demo link. `demoRender` makes the demo's files from the jobs' photos.
 */
export function createBackend(env: Record<string, string | undefined>, opts: { demoRender?: DemoRender } = {}): GenerationBackend {
  const kind = env.MONTAGIO_BACKEND ?? 'demo';
  const root = env.MONTAGIO_ROOT ?? process.cwd();
  switch (kind) {
    case 'demo':
      return new DemoBackend({
        clipsDir: env.MONTAGIO_DEMO_CLIPS ?? join(root, 'demo-assets', 'clips'),
        imagesDir: env.MONTAGIO_DEMO_IMAGES ?? join(root, 'demo-assets', 'images'),
        audioDir: env.MONTAGIO_DEMO_AUDIO ?? join(root, 'demo-assets', 'audio'),
        captionsDir: env.MONTAGIO_DEMO_CAPTIONS ?? join(root, 'demo-assets', 'captions'),
        durationMs: Number(env.MONTAGIO_DEMO_DURATION_MS ?? 6000),
        ...(opts.demoRender ? { render: opts.demoRender } : {}),
      });
    case 'local': {
      const baseUrl = env.COMFY_BASE_URL?.trim();
      if (!baseUrl) {
        throw new Error(
          'MONTAGIO_BACKEND=local needs COMFY_BASE_URL, the URL of your comfy-api-proxy (e.g. http://127.0.0.1:8189): ' +
            'without it the Comfy SDK would target Comfy Cloud',
        );
      }
      assertLocalBaseUrl(baseUrl);
      return new ComfyBackend({ baseUrl, outputsDir: join(env.MONTAGIO_DATA ?? join(root, 'data'), 'comfy-outputs') });
    }
    case 'hosted':
      throw new Error('Backend "hosted" is not available yet: it comes with the demo link');
    default:
      throw new Error(`Unknown backend "${kind}" (expected demo, local or hosted)`);
  }
}
