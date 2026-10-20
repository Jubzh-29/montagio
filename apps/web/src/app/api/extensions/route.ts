import { extensionsInfo } from '@/server/extensions';

// The flag is read on every request: a rejected extension disappears without a restart.
export async function GET() {
  return Response.json(await extensionsInfo());
}
