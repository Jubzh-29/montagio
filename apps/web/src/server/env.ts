import { join, resolve } from 'node:path';

export type ServerEnv = { root: string; data: string };

/** Paths are read on every call so tests (and restarts) can change them. */
export function getEnv(): ServerEnv {
  const root = resolve(process.env.MONTAGIO_ROOT ?? join(process.cwd(), '..', '..'));
  const data = resolve(process.env.MONTAGIO_DATA ?? join(root, 'data'));
  return { root, data };
}
