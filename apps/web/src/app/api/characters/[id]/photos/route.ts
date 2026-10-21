import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from '@/server/body';
import { addCharacterPhoto } from '@/server/characters';
import { jobFailureResponse } from '@/server/jobs';

/** Add a photodump picture to a character: `{ imageRef, scene, jobId? }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok || !read.value || typeof read.value !== 'object') return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    const character = await addCharacterPhoto((await params).id, read.value as Record<string, unknown>);
    return character ? Response.json(character) : Response.json({ error: 'not-found' }, { status: 404 });
  } catch (error) {
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
