import { jobs, jobSummary } from '@/server/jobs';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await jobs.cancel(id);
  if (!record) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json(jobSummary(record));
}
