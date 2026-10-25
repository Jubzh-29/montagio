import { namesThisSite } from '@/server/body';
import { jobs, jobSummary } from '@/server/jobs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const { id } = await params;
  const record = await jobs.cancel(id);
  if (!record) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json(jobSummary(record));
}
