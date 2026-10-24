import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from '@/server/body';
import { listCommunity, publishToCommunity } from '@/server/community';
import { jobFailureResponse } from '@/server/jobs';

/** The community gallery: what was published or imported here, then the examples. */
export async function GET() {
  return Response.json(await listCommunity());
}

/** Publish a creation of the history: `{ historyKey, title, author? }`. */
export async function POST(request: Request) {
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok || !read.value || typeof read.value !== 'object') return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    const entry = await publishToCommunity(read.value as Record<string, unknown>);
    return entry ? Response.json(entry, { status: 201 }) : Response.json({ error: 'not-found' }, { status: 404 });
  } catch (error) {
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
