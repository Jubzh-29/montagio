import { getServices } from '@/server/services';

export async function GET() {
  const lib = await getServices().library;
  return Response.json(
    [...lib.presets.values()].map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      previewUrl: `/media/presets/${preset.preview}`,
      poses: preset.camera.poses,
      speed: preset.camera.speed,
      defaultModel: preset.models.preferred,
    })),
  );
}
