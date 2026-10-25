import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { fromThisSite, readJsonBody } from '@/server/body';
import { visibleExtensions } from '@/server/extensions';
import { cutsOf, readRemixMeta, remixSummary } from '@/server/remix';

/** The shots of a trend for the cuts the user moved ({ remixRef, cuts }): their ranges and first frames. */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  if (!(await visibleExtensions()).includes('remix')) return Response.json({ error: 'extension-disabled' }, { status: 404 });
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: 'invalid-input' }, { status: 400 });
  const { remixRef, cuts: raw } = (read.value ?? {}) as { remixRef?: unknown; cuts?: unknown };
  const meta = await readRemixMeta(remixRef);
  if (!meta) return Response.json({ error: 'not-found' }, { status: 404 });
  const cuts = cutsOf(raw, meta.frames);
  if (!cuts) return Response.json({ error: 'invalid-input' }, { status: 400 });
  return Response.json(await remixSummary(meta, cuts));
}
