import { failureResponse } from '@/server/generations';
import { replaySeed } from '@/server/inputs';
import { createSequence } from '@/server/sequences';

type ShotInput = { presetId?: unknown; modelId?: unknown; userPrompt?: unknown; seed?: unknown };

const optionalString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return Response.json({ error: 'missing-idempotency-key' }, { status: 400 });

  let body: { imageRef?: unknown; shots?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid-json' }, { status: 400 });
  }
  if (typeof body.imageRef !== 'string') return Response.json({ error: 'invalid-request' }, { status: 400 });
  if (!Array.isArray(body.shots) || !body.shots.every((shot: ShotInput) => typeof shot?.presetId === 'string')) {
    return Response.json({ error: 'invalid-shots' }, { status: 400 });
  }

  try {
    const { record, created } = await createSequence({
      imageRef: body.imageRef,
      shots: (body.shots as ShotInput[]).map((shot) => ({
        presetId: shot.presetId as string,
        modelId: optionalString(shot.modelId),
        userPrompt: optionalString(shot.userPrompt)?.slice(0, 500),
        seed: replaySeed(shot.seed),
      })),
      idempotencyKey: idempotencyKey.slice(0, 200),
    });
    return Response.json(record, { status: created ? 201 : 200 });
  } catch (error) {
    const failure = failureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
