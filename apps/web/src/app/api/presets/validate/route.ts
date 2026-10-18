import { readJsonBody } from '@/server/body';
import { checkPresetText, GenerationError, MAX_REQUEST_BYTES } from '@/server/generations';

/** "Check preset" in the remix editor: the same checks as `montagio preset validate`, on the chosen model. */
export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok && body.reason === 'too-large') return Response.json({ error: 'preset-too-large' }, { status: 413 });
  const input = body.ok ? (body.value as { yaml?: unknown; modelId?: unknown } | null) : null;
  if (typeof input?.yaml !== 'string') return Response.json({ error: 'invalid-request' }, { status: 400 });
  const modelId = typeof input.modelId === 'string' && input.modelId.length > 0 ? input.modelId : undefined;

  try {
    const preset = await checkPresetText(input.yaml, modelId);
    return Response.json({
      ok: true,
      preset: { id: preset.id, name: preset.name, poses: preset.camera.poses, speed: preset.camera.speed },
    });
  } catch (error) {
    if (error instanceof GenerationError && error.code === 'invalid-preset') {
      return Response.json({ error: 'invalid-preset', problems: error.problems ?? [] }, { status: 422 });
    }
    if (error instanceof GenerationError && error.code === 'preset-too-large') {
      return Response.json({ error: 'preset-too-large' }, { status: 413 });
    }
    throw error;
  }
}
