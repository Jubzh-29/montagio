import { offeredModels } from '@/server/profile';
import { getServices } from '@/server/services';

export async function GET() {
  const lib = await getServices().library;
  return Response.json(
    // The models this install's memory profile offers, with their times there.
    offeredModels(lib).map((model) => ({
      id: model.id,
      name: model.name,
      kind: model.kind,
      tier: model.tier,
      license: model.license,
      estimate_s: model.estimate_s,
    })),
  );
}
