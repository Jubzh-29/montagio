import { join } from 'node:path';
import { getEnv } from '@/server/env';
import { saveUploadFromFile } from '@/server/uploads';

/** The sample photo, copied by the server as an upload of origin "sample": no consent to ask for it. */
export async function POST() {
  const sample = join(getEnv().root, 'demo-assets', 'images', 'sample-16x9.png');
  return Response.json(await saveUploadFromFile(sample, { origin: 'sample', personal: false }), { status: 201 });
}
