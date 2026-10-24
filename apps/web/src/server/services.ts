import { createBackend, type GenerationBackend } from '@montagio/comfy-adapter';
import { loadLibrary, type Library } from '@montagio/presets';
import { demoRender } from './demo-render';
import { getEnv } from './env';

type Services = { key: string; library: Promise<Library>; backend: GenerationBackend };

// Next.js bundles every route separately; keeping the services on globalThis
// lets all routes of one server process share the same backend jobs.
const holder = globalThis as typeof globalThis & { __montagioServices?: Services };

export function getServices(): Services {
  const { root, data } = getEnv();
  const key = `${root}|${data}|${process.env.MONTAGIO_BACKEND ?? 'demo'}|${process.env.COMFY_BASE_URL ?? ''}|${process.env.MONTAGIO_DEMO_RENDER ?? ''}`;
  if (!holder.__montagioServices || holder.__montagioServices.key !== key) {
    const library = loadLibrary(root);
    library.catch(() => undefined); // surfaced to callers that await it
    holder.__montagioServices = {
      key,
      library,
      // MONTAGIO_DEMO_RENDER=off keeps the pre-rendered files of demo-assets/ (the unit tests).
      backend: createBackend(
        { ...process.env, MONTAGIO_ROOT: root, MONTAGIO_DATA: data },
        process.env.MONTAGIO_DEMO_RENDER === 'off' ? {} : { demoRender: demoRender(library) },
      ),
    };
  }
  return holder.__montagioServices;
}

export function resetServicesForTests(): void {
  delete holder.__montagioServices;
}
