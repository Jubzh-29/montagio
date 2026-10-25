import { readJsonBody } from '@/server/body';
import { createGeneration, failureResponse, MAX_REQUEST_BYTES } from '@/server/generations';
import { replaySeed } from '@/server/inputs';

type Body = {
  presetId?: unknown;
  presetYaml?: unknown;
  modelId?: unknown;
  imageRef?: unknown;
  userPrompt?: unknown;
  negative?: unknown;
  seed?: unknown;
};

const optionalString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return Response.json({ error: 'missing-idempotency-key' }, { status: 400 });

  // Only a remixed preset makes this body large: past the cap, nothing more is read.
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) {
    return read.reason === 'too-large'
      ? Response.json({ error: 'preset-too-large' }, { status: 413 })
      : Response.json({ error: 'invalid-json' }, { status: 400 });
  }
  const body = (read.value ?? {}) as Body;
  const presetYaml = typeof body.presetYaml === 'string' ? body.presetYaml : undefined;
  if (typeof body.imageRef !== 'string' || (presetYaml === undefined && typeof body.presetId !== 'string')) {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }

  try {
    const { record, created } = await createGeneration({
      ...(presetYaml !== undefined ? { presetYaml } : { presetId: body.presetId as string }),
      imageRef: body.imageRef,
      modelId: optionalString(body.modelId),
      userPrompt: optionalString(body.userPrompt)?.slice(0, 500),
      negative: optionalString(body.negative)?.slice(0, 500),
      seed: replaySeed(body.seed),
      idempotencyKey: idempotencyKey.slice(0, 200),
    });
    return Response.json(record, { status: created ? 201 : 200 });
  } catch (error) {
    const failure = failureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
