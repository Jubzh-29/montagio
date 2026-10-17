import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkOpenStack, type OpenStackReport } from '@montagio/check-open-stack';
import { getEnv } from '@/server/env';

export async function GET() {
  const { root } = getEnv();
  try {
    const text = await readFile(join(root, 'apps', 'web', 'public', 'open-stack-report.json'), 'utf8');
    return Response.json(JSON.parse(text) as OpenStackReport);
  } catch {
    return Response.json(await checkOpenStack(root, { configDir: join(root, 'tools', 'check-open-stack') }));
  }
}
