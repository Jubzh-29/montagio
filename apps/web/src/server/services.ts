import { createBackend, type GenerationBackend } from '@montagio/comfy-adapter';
import { loadLibrary, type Library } from '@montagio/presets';
import { getEnv } from './env';

type Services = { key: string; library: Promise<Library>; backend: GenerationBackend };

// Next.js bundles every route separately; keeping the services on globalThis
// lets all routes of one server process share the same backend jobs.
const holder = globalThis as typeof globalThis & { __montagioServices?: Services };

export function getServices(): Services {
  const { root, data } = getEnv();
  const key = `${root}|${data}|${process.env.MONTAGIO_BACKEND ?? 'demo'}|${process.env.COMFY_BASE_URL ?? ''}`;
  if (!holder.__montagioServices || holder.__montagioServices.key !== key) {
    const library = loadLibrary(root);
    library.catch(() => undefined); // surfaced to callers that await it
    holder.__montagioServices = {
      key,
      library,
      backend: createBackend({ ...process.env, MONTAGIO_ROOT: root, MONTAGIO_DATA: data }),
    };
  }
  return holder.__montagioServices;
}

export function resetServicesForTests(): void {
  delete holder.__montagioServices;
}
