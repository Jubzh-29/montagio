import { readRecord, readWorkflow } from '@/server/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [record, workflow] = await Promise.all([readRecord(id), readWorkflow(id)]);
  if (!record || !workflow) return Response.json({ error: 'not-found' }, { status: 404 });
  return new Response(JSON.stringify(workflow, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="montagio-${record.presetId}-${id}.json"`,
    },
  });
}
