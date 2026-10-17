import { readOpenStackReport } from '@/server/open-stack';
import { getEnv } from '@/server/env';

export async function GET() {
  return Response.json(await readOpenStackReport(getEnv().root));
}
