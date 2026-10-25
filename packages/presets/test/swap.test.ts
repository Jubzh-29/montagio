import { fileURLToPath } from 'node:url';
import { CompileError, compileSwap, framePoint, loadLibrary, MAX_SWAP_POINTS, type Library, type SwapInputs } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const swap = () => {
  const model = lib.extensionModels.get('wan21-vace-swap');
  if (!model) throw new Error('no extension model wan21-vace-swap');
  return { model, template: lib.extensionTemplates.get(model.workflow)! };
};
const compile = (inputs: Partial<SwapInputs> = {}) =>
  compileSwap(swap().model, swap().template, {
    videoRef: 'clip.mp4',
    video_s: 5,
    source: { width: 1280, height: 720 },
    aspect: '16:9',
    seed: 7,
    prompt: 'a red vintage motorbike',
    points: [{ x: 0.5, y: 0.5 }],
    ...inputs,
  });

describe('framePoint (a point of the clip, once ComfyUI crops and scales its frame)', () => {
  test('a frame of the same aspect is only scaled, its far edge kept on the last pixel', () => {
    expect(framePoint({ x: 0.5, y: 0.5 }, { width: 1664, height: 960 }, { width: 832, height: 480 })).toEqual({ x: 416, y: 240 });
    expect(framePoint({ x: 0, y: 0 }, { width: 1664, height: 960 }, { width: 832, height: 480 })).toEqual({ x: 0, y: 0 });
    expect(framePoint({ x: 1, y: 1 }, { width: 1664, height: 960 }, { width: 832, height: 480 })).toEqual({ x: 831, y: 479 });
  });

  test('a 1280×720 clip loses 16 px on each side: 832×480 is a little narrower than 16:9', () => {
    expect(framePoint({ x: 0.5, y: 0.5 }, { width: 1280, height: 720 }, { width: 832, height: 480 })).toEqual({ x: 416, y: 240 });
    expect(framePoint({ x: 0.01, y: 0.5 }, { width: 1280, height: 720 }, { width: 832, height: 480 })).toBeNull();
    expect(framePoint({ x: 0.02, y: 0.5 }, { width: 1280, height: 720 }, { width: 832, height: 480 })).toEqual({ x: 6, y: 240 });
  });

  test('a wider frame loses its sides, evenly', () => {
    // 1920×1080 into 1:1: 420 px cut on each side, 1080 kept
    expect(framePoint({ x: 0.5, y: 0.5 }, { width: 1920, height: 1080 }, { width: 640, height: 640 })).toEqual({ x: 320, y: 320 });
    expect(framePoint({ x: 0.1, y: 0.5 }, { width: 1920, height: 1080 }, { width: 640, height: 640 })).toBeNull();
    expect(framePoint({ x: 0.25, y: 0.25 }, { width: 1920, height: 1080 }, { width: 640, height: 640 })).toEqual({ x: 36, y: 160 });
  });

  test('a taller frame loses its top and bottom, evenly', () => {
    // 1080×1920 into 832×480: 648 px cut at each end, 624 kept
    expect(framePoint({ x: 0.5, y: 0.5 }, { width: 1080, height: 1920 }, { width: 832, height: 480 })).toEqual({ x: 416, y: 240 });
    expect(framePoint({ x: 0.5, y: 0.1 }, { width: 1080, height: 1920 }, { width: 832, height: 480 })).toBeNull();
  });
});

describe('compileSwap (SAM 2.1 follows the object, Wan 2.1 VACE 14B redraws it)', () => {
  test("the object's points land in the scaled frame, as the JSON list the tracker reads", () => {
    const { workflow, params } = compile({ points: [{ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.75 }] });
    expect(workflow['41']!.class_type).toBe('Sam2VideoSegmentationAddPoints');
    expect(JSON.parse(String(workflow['41']!.inputs.coordinates_positive))).toEqual([{ x: 416, y: 240 }, { x: 203, y: 360 }]);
    expect(workflow['41']!.inputs.image).toEqual(['3', 0]);
    expect(params.points).toBe(2);
  });

  test('without excluded points the tracker gets no negative list; with some, it does', () => {
    expect(compile().workflow['41']!.inputs).not.toHaveProperty('coordinates_negative');
    const { workflow, params } = compile({ exclude: [{ x: 0.9, y: 0.1 }] });
    expect(JSON.parse(String(workflow['41']!.inputs.coordinates_negative))).toEqual([{ x: 757, y: 48 }]);
    expect(params.excluded).toBe(1);
  });

  test('points the crop cuts away are dropped; if none of the object is left, the job is refused', () => {
    const square = { aspect: '1:1' as const, source: { width: 1920, height: 1080 } };
    expect(compile({ ...square, points: [{ x: 0.5, y: 0.5 }, { x: 0.05, y: 0.5 }] }).params.points).toBe(1);
    expect(() => compile({ ...square, points: [{ x: 0.05, y: 0.5 }] })).toThrow(/outside the part of the frame a 1:1 video keeps/);
  });

  test('no point, too many, or one off the frame is refused', () => {
    expect(() => compile({ points: [] })).toThrow(CompileError);
    const many = Array.from({ length: MAX_SWAP_POINTS + 1 }, () => ({ x: 0.5, y: 0.5 }));
    expect(() => compile({ points: many })).toThrow(/over the 8/);
    expect(() => compile({ points: [{ x: 1.2, y: 0.5 }] })).toThrow(/not a fraction/);
    expect(() => compile({ exclude: [{ x: Number.NaN, y: 0.5 }] })).toThrow(/not a fraction/);
  });

  test('the mask is grown, painted grey over the frames, and is the control mask of VACE', () => {
    const { workflow } = compile();
    expect(workflow['43']!.inputs.mask).toEqual(['42', 0]);
    expect(workflow['45']!.class_type).toBe('ImageCompositeMasked');
    expect(workflow['45']!.inputs).toMatchObject({ destination: ['3', 0], source: ['44', 0], mask: ['43', 0] });
    expect(workflow['44']!.inputs.color).toBe(0x808080);
    expect(workflow['30']!.inputs).toMatchObject({ control_video: ['45', 0], control_masks: ['43', 0] });
  });

  test("the photo of the new object is fitted on white and is VACE's reference; without it, both nodes go", () => {
    const withPhoto = compile({ imageRef: 'bike.png' });
    expect(withPhoto.workflow['20']!.inputs.image).toBe('bike.png');
    expect(withPhoto.workflow['21']!.inputs).toMatchObject({ padding_color: 'white', target_width: 832, target_height: 480 });
    expect(withPhoto.workflow['30']!.inputs.reference_image).toEqual(['21', 0]);
    expect(withPhoto.params.reference).toBe(true);
    const textOnly = compile();
    expect(textOnly.workflow['20']).toBeUndefined();
    expect(textOnly.workflow['21']).toBeUndefined();
    expect(textOnly.workflow['30']!.inputs).not.toHaveProperty('reference_image');
    expect(textOnly.params.reference).toBe(false);
  });

  test("the clip's aspect sizes its frames, the grey, the photo and VACE's output", () => {
    for (const [aspect, width, height] of [['16:9', 832, 480], ['9:16', 480, 832], ['1:1', 640, 640]] as const) {
      const { workflow } = compile({ aspect, imageRef: 'bike.png' });
      for (const id of ['3', '44', '30']) {
        expect({ id, width: workflow[id]!.inputs.width, height: workflow[id]!.inputs.height }).toEqual({ id, width, height });
      }
      expect(workflow['21']!.inputs).toMatchObject({ target_width: width, target_height: height });
    }
  });

  test("a 5 s clip gives one VACE window of 81 frames; a shorter one the 4n+1 that cover it", () => {
    expect(compile().params.frames).toBe(81);
    expect(compile().workflow['7']!.inputs.length).toBe(81);
    expect(compile({ video_s: 3.2 }).params.frames).toBe(53);
    expect(compile({ video_s: 30 }).params.frames).toBe(81);
  });

  test('the text, the seed and the weights are bound; the tracker runs in fp16, from the locked "-fp16" file', () => {
    const { workflow } = compile({ prompt: '  a golden retriever ', seed: 42 });
    expect(workflow['14']!.inputs.text).toBe('a golden retriever');
    expect(workflow['31']!.inputs.seed).toBe(42);
    // SAM 2's attention allows Flash only on an L4 or a 4090, which has no fp32 kernel
    expect(workflow['40']!.inputs).toMatchObject({ model: 'sam2.1_hiera_base_plus.safetensors', segmentor: 'video', precision: 'fp16' });
    expect(lib.lock.get('sam21-hiera-base-plus')).toMatchObject({ file: 'sam2.1_hiera_base_plus-fp16.safetensors', extension: 'swap', folder: 'sam2' });
  });

  test('an empty or too long text, or a clip out of range, is refused', () => {
    expect(() => compile({ prompt: '  ' })).toThrow(/empty/);
    expect(() => compile({ prompt: 'x'.repeat(501) })).toThrow(/over the 500/);
    expect(() => compile({ video_s: 0.5 })).toThrow(/1 to 30 s/);
    expect(() => compile({ video_s: 31 })).toThrow(/1 to 30 s/);
  });
});
