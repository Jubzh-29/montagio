import { canonicalJson, findLocalPath, normalizeWorkflow, sha256Hex, summarizeWorkflow, workflowSha256 } from '../src';
import { cameraWorkflow, PHOTO_SLOT } from './fixtures';

describe('canonicalJson', () => {
  it('sorts the keys of every object and keeps no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps the order of arrays', () => {
    expect(canonicalJson({ list: [{ y: 1, x: 2 }, 3] })).toBe('{"list":[{"x":2,"y":1},3]}');
  });
});

describe('workflowSha256', () => {
  it('is the same for two workflows whose keys come in another order', () => {
    const a = { '1': { class_type: 'A', inputs: { x: 1, y: 2 } }, '2': { class_type: 'B', inputs: {} } };
    const b = { '2': { inputs: {}, class_type: 'B' }, '1': { inputs: { y: 2, x: 1 }, class_type: 'A' } };
    expect(workflowSha256(a)).toBe(workflowSha256(b));
    expect(workflowSha256(a)).toBe(sha256Hex(canonicalJson(a)));
  });

  it('changes when one value changes', () => {
    const other = cameraWorkflow();
    other['57']!.inputs.noise_seed = 43;
    expect(workflowSha256(cameraWorkflow())).not.toBe(workflowSha256(other));
  });
});

describe('normalizeWorkflow', () => {
  it('puts a marker in place of each input file, and leaves the original alone', () => {
    const workflow = cameraWorkflow();
    const normalized = normalizeWorkflow(workflow, [PHOTO_SLOT]);
    expect(normalized['58']!.inputs.image).toBe('<imageRef>');
    expect(workflow['58']!.inputs.image).toMatch(/^uploads\//);
  });

  it('gives one hash for two uploads of the same photo', () => {
    const b = cameraWorkflow();
    b['58']!.inputs.image = 'uploads/ffffffff-0000-4000-8000-000000000000.jpg';
    expect(workflowSha256(normalizeWorkflow(cameraWorkflow(), [PHOTO_SLOT]))).toBe(workflowSha256(normalizeWorkflow(b, [PHOTO_SLOT])));
  });
});

describe('summarizeWorkflow', () => {
  it('reads the size, the frames, the rate, the steps, the guidance, the seeds and the texts', () => {
    expect(summarizeWorkflow(normalizeWorkflow(cameraWorkflow(), [PHOTO_SLOT]))).toEqual({
      width: 832,
      height: 480,
      frames: 81,
      fps: 16,
      steps: 4,
      cfg: 1,
      seeds: [42],
      texts: ['A harbour at dawn, slow push in', 'blurry, static'],
    });
  });
});

describe('findLocalPath', () => {
  it.each([
    'C:\\Users\\someone\\Pictures\\me.jpg',
    'D:/montagio/data/uploads/a.png',
    '\\\\nas\\share\\a.png',
    '/home/someone/a.png',
    '/Users/someone/a.png',
    'uploads/1b2c3d4e-0000-4000-8000-123456789abc.jpg',
  ])('finds %s', (path) => {
    expect(findLocalPath({ deep: [{ value: path }] })).toBe(path);
  });

  it.each([
    '/api/generations',
    '/open-stack#model-x',
    'https://huggingface.co/a/b',
    'wan_2.1_vae.safetensors',
    '<imageRef>',
    'tts/chatterbox/resembleai-mtl-v3',
  ])('leaves %s alone', (value) => {
    expect(findLocalPath([value])).toBeNull();
  });
});
