import { createGeneration, failureResponse } from '@/server/generations';

type Body = { presetId?: unknown; modelId?: unknown; imageRef?: unknown; userPrompt?: unknown; seed?: unknown };

const optionalString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return Response.json({ error: 'missing-idempotency-key' }, { status: 400 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid-json' }, { status: 400 });
  }
  if (typeof body.presetId !== 'string' || typeof body.imageRef !== 'string') {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }

  try {
    const { record, created } = await createGeneration({
      presetId: body.presetId,
      imageRef: body.imageRef,
      modelId: optionalString(body.modelId),
      userPrompt: optionalString(body.userPrompt)?.slice(0, 500),
      seed: Number.isInteger(body.seed) ? (body.seed as number) : undefined,
      idempotencyKey: idempotencyKey.slice(0, 200),
    });
    return Response.json(record, { status: created ? 201 : 200 });
  } catch (error) {
    const failure = failureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
