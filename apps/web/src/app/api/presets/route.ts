import { getEnv } from '@/server/env';
import { galleryOrder, presetPosterUrl, presetPreviewUrl } from '@/server/gallery';
import { getServices } from '@/server/services';

export async function GET() {
  const lib = await getServices().library;
  const { root } = getEnv();
  return Response.json(
    await Promise.all(
      galleryOrder([...lib.presets.values()]).map(async (preset) => {
        const previewUrl = await presetPreviewUrl(root, preset.preview);
        const posterUrl = previewUrl && (await presetPosterUrl(root, preset.preview));
        return {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          ...(previewUrl ? { previewUrl } : {}),
          ...(posterUrl ? { posterUrl } : {}),
          poses: preset.camera.poses,
          speed: preset.camera.speed,
          defaultModel: preset.models.preferred,
        };
      }),
    ),
  );
}
