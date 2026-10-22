import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkOpenStack, type OpenStackReport } from '@montagio/check-open-stack';

type Scan = (root: string) => Promise<OpenStackReport>;

const scanRepository: Scan = (root) => checkOpenStack(root, { configDir: join(root, 'tools', 'check-open-stack') });

/** A report of this check's shape: one that an older check wrote lists its models without their function. */
function isCurrent(report: OpenStackReport): boolean {
  return Array.isArray(report.models) && report.models.every((model) => typeof model.function === 'string');
}

/**
 * Reads the report written by `npm run check:open-stack`. That file is not
 * committed, so a fresh checkout falls back to scanning the repository, as does
 * a file an older check left behind. The scan takes seconds: it runs once per
 * root for the life of the process and concurrent requests share it. A failed
 * scan is dropped so the next request retries.
 */
export function createOpenStackReader(scan: Scan = scanRepository): (root: string) => Promise<OpenStackReport> {
  const scans = new Map<string, Promise<OpenStackReport>>();
  return async (root) => {
    try {
      const text = await readFile(join(root, 'apps', 'web', 'public', 'open-stack-report.json'), 'utf8');
      const report = JSON.parse(text) as OpenStackReport;
      if (!isCurrent(report)) throw new Error('report written by an older check');
      return report;
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
