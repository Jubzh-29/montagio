import { readJobWorkflow } from '@/server/jobs';
import { readRecord, readWorkflow } from '@/server/store';

const download = (workflow: unknown, name: string) =>
  new Response(JSON.stringify(workflow, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${name}"` },
  });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [record, workflow] = await Promise.all([readRecord(id), readWorkflow(id)]);
  if (record && workflow) return download(workflow, `montagio-${record.presetId}-${id}.json`);
  // Not a camera clip: an image, an effect or a hook, whose last step is what ComfyUI gets.
  const job = await readJobWorkflow(id);
  if (job) return download(job.workflow, `montagio-${job.record.label.itemId ?? job.record.task}-${id}.json`);
  return Response.json({ error: 'not-found' }, { status: 404 });
}
