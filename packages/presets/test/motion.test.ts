import { fileURLToPath } from 'node:url';
import { compileMotion, CompileError, loadLibrary, motionWindows, type Library, type MotionInputs } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const motion = () => {
  const model = lib.extensionModels.get('wan-animate2-motion')!;
  return { model, template: lib.extensionTemplates.get(model.workflow)! };
};
const compile = (inputs: Partial<MotionInputs> = {}) =>
  compileMotion(motion().model, motion().template, { imageRef: 'start.png', videoRef: 'clip.mp4', video_s: 5, aspect: '9:16', seed: 3, ...inputs });

describe('compileMotion (Wan2.2-Animate-2 distilled), up to 30 s', () => {
  test('5 s is one window of 81 frames: the context windows are removed, the model goes to its cache', () => {
    const { workflow, params } = compile();
    expect([params.frames, params.windows]).toEqual([81, 1]);
    expect(workflow['610']).toBeUndefined();
    expect(workflow['594']!.inputs.model).toEqual(['578', 0]);
    expect(workflow['587']!.inputs.length).toBe(81);
  });

  test('30 s is 481 frames sampled through the context windows of the template (21 latent frames, overlap 8)', () => {
    const { workflow, params } = compile({ video_s: 30 });
    expect([params.frames, params.windows]).toEqual([481, 9]);
    expect(workflow['587']!.inputs.length).toBe(481);
    expect(workflow['594']!.inputs.model).toEqual(['610', 0]);
    expect(workflow['610']!.inputs).toMatchObject({ model: ['578', 0], context_length: 21, context_overlap: 8, fuse_method: 'pyramid', freenoise: true });
  });

  test('a 12.3 s clip covers its frames in 4n+1, and the windows follow', () => {
    const { params } = compile({ video_s: 12.3 });
    expect(params.frames).toBe(197);
    expect(params.windows).toBe(motionWindows(197));
    expect(motionWindows(81)).toBe(1);
    expect(motionWindows(85)).toBe(2);
    expect(motionWindows(481)).toBe(9);
  });

  test('a clip over 30 s, or under 1 s, is refused; a few milliseconds over 30 s pass', () => {
    expect(() => compile({ video_s: 31 })).toThrow(/30 s/);
    expect(() => compile({ video_s: 0.5 })).toThrow(CompileError);
    expect(compile({ video_s: 30.04 }).params.frames).toBe(481);
  });

  test('the template keeps its context windows node', () => {
    expect(motion().template['610']!.class_type).toBe('ContextWindowsManual');
  });
});
