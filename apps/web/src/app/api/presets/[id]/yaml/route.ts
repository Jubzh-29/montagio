import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnv } from '@/server/env';
import { getServices } from '@/server/services';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lib = await getServices().library;
  if (!lib.presets.has(id)) return Response.json({ error: 'not-found' }, { status: 404 });
  const text = await readFile(join(getEnv().root, 'presets', `${id}.yaml`), 'utf8');
  return new Response(text, {
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': `attachment; filename="montagio-preset-${id}.yaml"`,
    },
  });
}
