import { MAX_REQUEST_BYTES } from '@/lib/limits';
import { readJsonBody } from '@/server/body';
import { replaySeed } from '@/server/inputs';
import { jobFailureResponse } from '@/server/jobs';
import { createSequence } from '@/server/sequences';

type ShotInput = { presetId?: unknown; modelId?: unknown; userPrompt?: unknown; seed?: unknown };

const optionalString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return Response.json({ error: 'missing-idempotency-key' }, { status: 400 });

  // Past the cap, nothing more is read: a film's body is a photo's ref and a few shots.
  const read = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return Response.json({ error: read.reason === 'too-large' ? 'invalid-request' : 'invalid-json' }, { status: 400 });
  const body = (read.value && typeof read.value === 'object' ? read.value : {}) as { imageRef?: unknown; shots?: unknown };
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
    const failure = jobFailureResponse(error);
    if (failure) return failure;
    throw error;
  }
}
