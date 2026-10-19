// Options of the showcase build (showcase-build.mjs), kept apart so they can be tested.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The URL prefix of a GitHub Pages project site ("/montagio"), or '' at the root
 * of a host. "montagio" is accepted too: Git Bash rewrites an argument that starts
 * with "/" into a Windows path ("C:/Program Files/Git/montagio").
 */
export function normalizeBasePath(raw) {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (!/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(trimmed)) {
    throw new Error(
      `--base-path must be a URL path such as /montagio, got "${raw}" ` +
        '(under Git Bash, write it without the leading slash: --base-path montagio)',
    );
  }
  return `/${trimmed}`;
}

/**
 * MONTAGIO_REPO_URL, the public repository the showcase links to (AGPL-3.0 §13):
 * an absolute https URL without credentials, or '' when it is not set.
 */
export function normalizeRepoUrl(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }
  if (url?.protocol !== 'https:') {
    throw new Error(`MONTAGIO_REPO_URL must be an absolute https URL such as https://github.com/<you>/montagio, got "${raw}"`);
  }
  if (url.username || url.password) throw new Error('MONTAGIO_REPO_URL must not carry credentials: the showcase publishes it');
  return trimmed;
}

/**
 * What `next build` left in `nextDir` (apps/web/.next): 'server' for a production
 * build that `next start` serves, 'export' for a static export (the showcase), 'none'
 * when there is no build (`next dev` keeps its state in .next/dev).
 */
export function nextBuildKind(nextDir) {
  if (!existsSync(join(nextDir, 'BUILD_ID'))) return 'none';
  let output;
  try {
    output = JSON.parse(readFileSync(join(nextDir, 'required-server-files.json'), 'utf8')).config?.output;
  } catch {
    return 'none';
  }
  return output === 'export' ? 'export' : 'server';
}
