import { getServices } from '@/server/services';

export async function GET() {
  const lib = await getServices().library;
  return Response.json(
    [...lib.models.values()].map((model) => ({
      id: model.id,
      name: model.name,
      kind: model.kind,
      tier: model.tier,
      license: model.license,
      estimate_s: model.estimate_s,
    })),
  );
}
