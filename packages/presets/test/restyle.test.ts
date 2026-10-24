import { fileURLToPath } from 'node:url';
import { compileRestyle, CompileError, loadLibrary, restyleInstruction, type Library, type RestyleInputs } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const restyle = () => {
  const model = lib.extensionModels.get('wan21-vace-restyle');
  if (!model) throw new Error('no extension model wan21-vace-restyle');
  return { model, template: lib.extensionTemplates.get(model.workflow)! };
};
const compile = (inputs: Partial<RestyleInputs> = {}) =>
  compileRestyle(restyle().model, restyle().template, {
    videoRef: 'clip.mp4',
    video_s: 5,
    aspect: '16:9',
    seed: 7,
    prompt: 'a snowy winter evening',
    ...inputs,
  });

/** The nodes of the reference image (20, 21) and of the restyled first frame with its mask (22 to 27). */
const REFERENCE_NODES = ['20', '21'];
const FIRST_FRAME_NODES = ['22', '23', '24', '25', '26', '27'];

describe('compileRestyle (Wan 2.1 VACE 14B on the depth of a clip)', () => {
  test('a 5 s clip at 16 fps gives the 81 frames of one VACE window', () => {
    const { workflow, params } = compile();
    expect(params.frames).toBe(81);
    expect(workflow['30']!.inputs.length).toBe(81);
  });

  test('a shorter clip gives the 4n+1 frames that cover it', () => {
    expect(compile({ video_s: 3.2 }).params.frames).toBe(53);
    expect(compile({ video_s: 1 }).params.frames).toBe(17);
  });

  test("the clip's aspect sizes its frames, the reference, the mask and VACE's output", () => {
    for (const [aspect, width, height] of [['16:9', 832, 480], ['9:16', 480, 832], ['1:1', 640, 640]] as const) {
      const { workflow } = compile({ aspect, reference: { imageRef: 'ref.png', mode: 'first-frame' } });
      for (const id of ['3', '21', '24', '25', '30']) {
        expect({ id, width: workflow[id]!.inputs.width, height: workflow[id]!.inputs.height }).toEqual({ id, width, height });
      }
    }
  });

  test('the clip, the text, the seed and the depth control are bound', () => {
    const { workflow, params } = compile({ prompt: '  a snowy winter evening ', seed: 42 });
    expect(workflow['1']!.inputs.file).toBe('clip.mp4');
    expect(workflow['14']!.inputs.text).toBe('a snowy winter evening');
    expect(params.prompt).toBe('a snowy winter evening');
    expect(workflow['31']!.inputs.seed).toBe(42);
    expect(workflow['4']!.class_type).toBe('DA3Render');
    expect(workflow['6']!.inputs.image).toEqual(['3', 0]);
  });

  test('without a reference, VACE follows the depth and the text only', () => {
    const { workflow, params } = compile();
    for (const id of [...REFERENCE_NODES, ...FIRST_FRAME_NODES]) expect(workflow[id]).toBeUndefined();
    expect(workflow['30']!.inputs.control_video).toEqual(['4', 0]);
    expect(workflow['30']!.inputs).not.toHaveProperty('reference_image');
    expect(workflow['30']!.inputs).not.toHaveProperty('control_masks');
    expect(params.reference).toBeNull();
  });

  test('an image to follow is the reference of VACE, the depth stays the control of every frame', () => {
    const { workflow, params } = compile({ reference: { imageRef: 'look.png', mode: 'look' } });
    expect(workflow['20']!.inputs.image).toBe('look.png');
    for (const id of FIRST_FRAME_NODES) expect(workflow[id]).toBeUndefined();
    expect(workflow['30']!.inputs.reference_image).toEqual(['21', 0]);
    expect(workflow['30']!.inputs.control_video).toEqual(['4', 0]);
    expect(workflow['30']!.inputs).not.toHaveProperty('control_masks');
    expect(params.reference).toBe('look');
  });

  test('a restyled first frame is kept as frame 1 (mask 0), the depth drives the others (mask 1)', () => {
    const { workflow, params } = compile({ reference: { imageRef: 'first.png', mode: 'first-frame' } });
    expect(workflow['20']!.inputs.image).toBe('first.png');
    expect(workflow['22']!.inputs).toMatchObject({ image: ['4', 0], batch_index: 1, length: 80 });
    expect(workflow['23']!.inputs).toEqual({ image1: ['21', 0], image2: ['22', 0] });
    expect(workflow['24']!.inputs).toMatchObject({ batch_size: 1, color: 0 });
    expect(workflow['25']!.inputs).toMatchObject({ batch_size: 80, color: 0xffffff });
    expect(workflow['30']!.inputs).toMatchObject({ control_video: ['23', 0], control_masks: ['27', 0], reference_image: ['21', 0] });
    expect(params.reference).toBe('first-frame');
  });

  test('the first frame and its mask follow a shorter clip', () => {
    const { workflow } = compile({ video_s: 3.2, reference: { imageRef: 'first.png', mode: 'first-frame' } });
    expect(workflow['22']!.inputs.length).toBe(52);
    expect(workflow['25']!.inputs.batch_size).toBe(52);
  });

  test('an empty text, or one over 500 characters, is refused', () => {
    expect(() => compile({ prompt: '   ' })).toThrow(CompileError);
    expect(() => compile({ prompt: 'a'.repeat(501) })).toThrow(/500/);
    expect(() => compile({ prompt: 'a'.repeat(500) })).not.toThrow();
  });

  test('a clip under 1 s or over 5 s is refused; a few milliseconds over 5 s pass', () => {
    expect(() => compile({ video_s: 0.5 })).toThrow(CompileError);
    expect(() => compile({ video_s: 5.5 })).toThrow(/5 s/);
    expect(compile({ video_s: 5.04 }).params.frames).toBe(81);
  });

  test('the shipped workflow loads VACE cast to fp8, with its 4-step LoRA, and saves node 35', () => {
    const { workflow, output } = compile();
    expect(workflow['10']!.inputs).toMatchObject({ unet_name: 'wan2.1_vace_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' });
    expect(workflow['31']!.inputs).toMatchObject({ steps: 4, cfg: 1 });
    expect(output).toEqual({ node: '35', kind: 'video' });
  });

  test('the template is not modified', () => {
    const before = JSON.stringify(restyle().template);
    compile();
    compile({ reference: { imageRef: 'look.png', mode: 'look' } });
    expect(JSON.stringify(restyle().template)).toBe(before);
  });

  test('a model of another task is refused', () => {
    const motion = lib.extensionModels.get('wan-animate2-motion')!;
    expect(() =>
      compileRestyle(motion, restyle().template, { videoRef: 'clip.mp4', video_s: 5, aspect: '16:9', seed: 1, prompt: 'x' }),
    ).toThrow(/v2v-restyle/);
  });
});

describe('restyleInstruction (the edit that restyles the first frame)', () => {
  test('asks for the new look and keeps the frame as it is', () => {
    const instruction = restyleInstruction('  a snowy winter evening ');
    expect(instruction).toContain('a snowy winter evening');
    expect(instruction).toMatch(/framing/);
    expect(instruction).toMatch(/pose/);
  });
});
