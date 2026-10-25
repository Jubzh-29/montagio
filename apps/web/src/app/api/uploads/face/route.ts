import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FACES_WITH_PICTURE, faceById } from '@/lib/character-bank';
import { namesThisSite } from '@/server/body';
import { getEnv } from '@/server/env';
import { saveUploadFromFile } from '@/server/uploads';

/**
 * A starting face (?id=), copied by the server as an upload of origin "sample": a fictional character
 * made from a text, so no consent to ask, and one a character may be made of.
 */
export async function POST(request: Request) {
  // A body-less POST: another site could send it without the browser asking first.
  if (!namesThisSite(request)) return Response.json({ error: 'cross-site' }, { status: 403 });
  const face = faceById(new URL(request.url).searchParams.get('id') ?? '');
  if (!face || !FACES_WITH_PICTURE.includes(face.id)) return Response.json({ error: 'not-found' }, { status: 404 });
  const file = join(getEnv().root, 'demo-assets', 'faces', `${face.id}.jpg`);
  try {
    await access(file);
  } catch {
    return Response.json({ error: 'not-found' }, { status: 404 });
  }
  return Response.json(await saveUploadFromFile(file, { origin: 'sample', personal: false, fictional: true }), { status: 201 });
}
