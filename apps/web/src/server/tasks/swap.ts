import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { compileSwap, dimensionsFor, framePoint, MAX_SWAP_POINTS, type SwapInputs, type SwapPoint } from '@montagio/presets';
import { JobError } from '../errors';
import { requireExtension, swapModel } from '../extensions';
import { assertAllowedText } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta, readVideoMeta } from '../uploads';
import { extensionFile, uploadPath, videoPath } from './files';

const TEXT_MAX = 500;

/** Points in fractions of the first frame: a list of {x, y} between 0 and 1, `max` at most. */
function pointsOf(raw: unknown, max: number): SwapPoint[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > max) return null;
  const points: SwapPoint[] = [];
  for (const entry of raw) {
    const { x, y } = (entry ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
    points.push({ x, y });
  }
  return points;
}

/**
 * An object swap (SAM 2.1, then Wan 2.1 VACE 14B): the object the points mark on the clip's first
 * frame (the Studio derives them from what is painted over it) is followed through the clip and
 * redrawn from the text, and from the photo of the new object when there is one; the rest of the clip
 * stays as it was filmed. The user's word that they hold the rights on the clip and the photo, and
 * that the people filmed agree, is required.
 */
export const swapTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('swap');
    const videoRef = typeof body.videoRef === 'string' ? body.videoRef : '';
    const video = await readVideoMeta(videoRef);
    if (!video) throw new JobError('invalid-input');
    const imageRef = typeof body.imageRef === 'string' ? body.imageRef : '';
    const photo = imageRef ? await readUploadMeta(imageRef) : null;
    if (imageRef && !photo) throw new JobError('unknown-image');
    if (body.rights !== true) throw new JobError('rights-required');
    const model = swapModel(lib);
    const max = model.limits.max_chars ?? TEXT_MAX;
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > max) throw new JobError('invalid-input');
    await assertAllowedText(prompt);
    const points = pointsOf(body.points, MAX_SWAP_POINTS);
    const exclude = pointsOf(body.exclude, MAX_SWAP_POINTS);
    if (!points || points.length === 0 || !exclude) throw new JobError('invalid-input');
    // The points must mark something the aspect's crop keeps, or the tracker would follow nothing.
    const target = dimensionsFor(video.aspect, '480p');
    if (!points.some((point) => framePoint(point, video, target))) throw new JobError('invalid-input');
    return {
      inputs: {
        videoRef,
        video_s: video.duration_s,
        width: video.width,
        height: video.height,
        prompt,
        points,
        ...(exclude.length > 0 ? { exclude } : {}),
        ...(photo ? { imageRef } : {}),
        personal: photo?.personal ?? false,
      },
      label: { name: model.name },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: video.aspect,
    };
  },

  steps: (_record, lib) => [
    {
      name: 'swap',
      presetId: 'swap',
      extension: 'swap',
      compile: async (current) => {
        const model = lib.extensionModels.get(current.modelId)!;
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const videoFile = videoPath(String(current.inputs.videoRef));
        const imageRef = typeof current.inputs.imageRef === 'string' ? current.inputs.imageRef : undefined;
        const inputs: SwapInputs = {
          videoRef: basename(videoFile),
          video_s: Number(current.inputs.video_s),
          source: { width: Number(current.inputs.width), height: Number(current.inputs.height) },
          aspect: current.aspect ?? '16:9',
          seed: current.seed,
          prompt: String(current.inputs.prompt),
          points: current.inputs.points as SwapPoint[],
          ...(current.inputs.exclude ? { exclude: current.inputs.exclude as SwapPoint[] } : {}),
          ...(imageRef ? { imageRef: basename(uploadPath(imageRef)) } : {}),
        };
        const { workflow, output } = compileSwap(model, template, inputs);
        const files = [extensionFile(model, 'video', videoFile)];
        if (imageRef) files.push(extensionFile(model, 'image', uploadPath(imageRef)));
        return { workflow, output, files };
      },
    },
  ],
};
