import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecipeStack } from './types';

/** KEY=VALUE lines of infra/runpod/versions.env, comments and blank lines skipped. */
function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (line && !line.startsWith('#') && eq > 0) values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

/** The commit of the checkout at `root`, or null outside git (an archive, a showcase build machine without it). */
function gitHead(root: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const commit = String(stdout).trim();
      done(!error && /^[0-9a-f]{40}$/.test(commit) ? commit : null);
    });
  });
}

/**
 * The stack a recipe ran on, as this checkout pins it: Montagio's version and commit (MONTAGIO_COMMIT
 * first, for a copy without git), ComfyUI's tag and commit, comfy-api-proxy, Montagio's node pack and
 * each pinned third-party pack (its *_NODE_REPO and *_NODE_COMMIT).
 */
export async function readStack(root: string, env: Record<string, string | undefined> = process.env): Promise<RecipeStack> {
  const [pkg, pins, pyproject] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8').then((text) => JSON.parse(text) as { version?: string }),
    readFile(join(root, 'infra', 'runpod', 'versions.env'), 'utf8').then(parseEnvFile),
    readFile(join(root, 'comfy-nodes', 'pyproject.toml'), 'utf8').catch(() => ''),
  ]);
  const packVersion = /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
  const packs = Object.keys(pins)
    .filter((key) => key.endsWith('_NODE_REPO'))
    .map((key) => {
      const repo = pins[key]!;
      const commit = pins[key.replace(/_REPO$/, '_COMMIT')];
      return { name: repo.replace(/\.git$/, '').split('/').at(-1)!, repo, ...(commit ? { commit } : {}) };
    });
  return {
    montagio: { version: pkg.version ?? '0.0.0', commit: env.MONTAGIO_COMMIT?.trim() || (await gitHead(root)) },
    comfyui: { tag: pins.COMFYUI_TAG ?? '', commit: pins.COMFYUI_COMMIT ?? '' },
    proxy: pins.COMFY_API_PROXY_VERSION ?? '',
    nodes: [{ name: 'montagio', ...(packVersion ? { version: packVersion } : {}) }, ...packs],
  };
}
