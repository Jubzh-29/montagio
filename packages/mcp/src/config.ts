import { resolve } from 'node:path';

/** Where `npm run dev` and the installer start the app. */
export const DEFAULT_URL = 'http://127.0.0.1:3000';
/** How long a tool waits for a render before it stops waiting (the render goes on in the app). */
export const DEFAULT_TIMEOUT_MINUTES = 30;
/** The app moves a render forward when it is polled: every 2 s, like the Studio's pace. */
export const POLL_INTERVAL_MS = 2000;

export type Config = {
  /** The running Montagio app, without a trailing slash. */
  baseUrl: string;
  /** The folder finished files are downloaded to; absent, the tools return URLs only. */
  outDir?: string;
  pollIntervalMs: number;
  timeoutMs: number;
};

/** The server's settings, from MONTAGIO_URL and MONTAGIO_MCP_OUT. */
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = env.MONTAGIO_URL?.trim() || DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MONTAGIO_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`MONTAGIO_URL must be an http(s) URL: ${raw}`);
  const out = env.MONTAGIO_MCP_OUT?.trim();
  return {
    baseUrl: url.href.replace(/\/+$/, ''),
    ...(out ? { outDir: resolve(out) } : {}),
    pollIntervalMs: POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
  };
}
