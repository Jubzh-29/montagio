import { listHistory } from '@/server/history';

/** Everything made on this machine, newest first (data/generations, data/sequences, data/jobs). */
export async function GET() {
  return Response.json(await listHistory());
}
