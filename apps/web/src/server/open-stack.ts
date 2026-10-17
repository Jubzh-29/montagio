import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkOpenStack, type OpenStackReport } from '@montagio/check-open-stack';

type Scan = (root: string) => Promise<OpenStackReport>;

const scanRepository: Scan = (root) => checkOpenStack(root, { configDir: join(root, 'tools', 'check-open-stack') });

/**
 * Reads the report written by `npm run check:open-stack`. That file is not
 * committed, so a fresh checkout falls back to scanning the repository. The
 * scan takes seconds: it runs once per root for the life of the process and
 * concurrent requests share it. A failed scan is dropped so the next request
 * retries.
 */
export function createOpenStackReader(scan: Scan = scanRepository): (root: string) => Promise<OpenStackReport> {
  const scans = new Map<string, Promise<OpenStackReport>>();
  return async (root) => {
    try {
      const text = await readFile(join(root, 'apps', 'web', 'public', 'open-stack-report.json'), 'utf8');
      return JSON.parse(text) as OpenStackReport;
    } catch {
      let pending = scans.get(root);
      if (!pending) {
        pending = scan(root);
        scans.set(root, pending);
        pending.catch(() => scans.delete(root));
      }
      return pending;
    }
  };
}

export const readOpenStackReport = createOpenStackReader();
