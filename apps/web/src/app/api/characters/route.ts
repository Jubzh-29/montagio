import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from '@/server/body';
import { createCharacter, listCharacters } from '@/server/characters';
import { jobFailureResponse } from '@/server/jobs';

/** The saved characters, newest first. */
export async function GET() {
  return Response.json(await listCharacters());
}

/** Save a character: `{ name, type, description, imageRef }`, the portrait made from a text. */
export async function POST(request: Request) {
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok || !read.value || typeof read.value !== 'object') return Response.json({ error: 'invalid-input' }, { status: 400 });
  try {
    return Response.json(await createCharacter(read.value as Record<string, unknown>), { status: 201 });
  } catch (error) {
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
