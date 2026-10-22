import { join } from 'node:path';
import { getEnv } from '@/server/env';
import { saveUploadFromFile } from '@/server/uploads';

/**
 * The sample photo of each tab (?for=), Z-Image-Turbo photos with no real person: a subject for an
 * effect, a face for an avatar, a full-length character for a motion, the harbour for a camera move.
 */
const SAMPLES: Record<string, string> = {
  effects: 'sample-subject.png',
  avatar: 'sample-portrait.png',
  motion: 'sample-character.png',
};

/** The sample photo, copied by the server as an upload of origin "sample": no consent to ask for it. */
export async function POST(request?: Request) {
  const forTab = request ? new URL(request.url).searchParams.get('for') : null;
  const file = (forTab && SAMPLES[forTab]) || 'sample-16x9.png';
  const sample = join(getEnv().root, 'demo-assets', 'images', file);
  return Response.json(await saveUploadFromFile(sample, { origin: 'sample', personal: false }), { status: 201 });
}
