import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenStackReport } from '@montagio/check-open-stack';
import { createOpenStackReader } from '@/server/open-stack';

const report = (ok: boolean): OpenStackReport => ({ ok, checkedAt: '2026-10-17T12:00:00.000Z', models: [], violations: [] });

/** A repository root without `apps/web/public/open-stack-report.json`, like a fresh checkout. */
const rootWithoutReport = () => mkdtempSync(join(tmpdir(), 'montagio-open-stack-'));

describe('open-stack report', () => {
  test('without a report file, concurrent and later requests share one scan', async () => {
    const root = rootWithoutReport();
    let scans = 0;
    const read = createOpenStackReader(async () => {
      scans += 1;
      return report(true);
    });

    const concurrent = await Promise.all([read(root), read(root)]);
    const later = await read(root);

    expect(scans).toBe(1);
    expect([...concurrent, later]).toEqual([report(true), report(true), report(true)]);
  });

  test('a failed scan is not kept: the next request scans again', async () => {
    const root = rootWithoutReport();
    let scans = 0;
    const read = createOpenStackReader(async () => {
      scans += 1;
      if (scans === 1) throw new Error('scan failed');
      return report(true);
    });

    await expect(read(root)).rejects.toThrow('scan failed');
    expect(await read(root)).toEqual(report(true));
    expect(scans).toBe(2);
  });

  test('each repository root gets its own scan', async () => {
    const scanned: string[] = [];
    const read = createOpenStackReader(async (root) => {
      scanned.push(root);
      return report(true);
    });
    const [first, second] = [rootWithoutReport(), rootWithoutReport()];

    await read(first);
    await read(second);

    expect(scanned).toEqual([first, second]);
  });

  test('the report file is read on every request and no scan runs', async () => {
    const root = rootWithoutReport();
    const read = createOpenStackReader(async () => {
      throw new Error('no scan expected');
    });
    const file = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
    mkdirSync(join(file, '..'), { recursive: true });

    writeFileSync(file, JSON.stringify(report(true)));
    expect(await read(root)).toEqual(report(true));
    writeFileSync(file, JSON.stringify(report(false)));
    expect(await read(root)).toEqual(report(false));
  });

  test('a report an older check wrote (models without their function) is not served: the repository is scanned', async () => {
    const root = rootWithoutReport();
    let scans = 0;
    const fresh: OpenStackReport = {
      ...report(true),
      models: [{ id: 'z-image-turbo', name: 'Z-Image Turbo', function: 'photo', license: 'Apache-2.0', weights: [] }],
    };
    const read = createOpenStackReader(async () => {
      scans += 1;
      return fresh;
    });
    const file = join(root, 'apps', 'web', 'public', 'open-stack-report.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...report(true), models: [{ id: 'z-image-turbo', license: 'Apache-2.0', weights: [] }] }));

    expect(await read(root)).toEqual(fresh);
    expect(scans).toBe(1);
  });
});
