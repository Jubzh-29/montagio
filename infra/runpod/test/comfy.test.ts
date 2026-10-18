import { assertLocalBaseUrl, checkWorkflow, comboOptions, guardFetch, parseNvidiaSmiLine } from '../lib/comfy';

describe('assertLocalBaseUrl', () => {
  test('accepts the local proxy and says it is loopback', () => {
    const target = assertLocalBaseUrl('http://127.0.0.1:8189/');
    expect(target.url.origin).toBe('http://127.0.0.1:8189');
    expect(target.base).toBe('http://127.0.0.1:8189');
    expect(target.loopback).toBe(true);
  });

  test('accepts another self-hosted host but flags it as not loopback', () => {
    expect(assertLocalBaseUrl('http://10.0.0.5:8189').loopback).toBe(false);
  });

  test('refuses a blank value, which the SDK would turn into Comfy Cloud', () => {
    expect(() => assertLocalBaseUrl('  ')).toThrow(/explicit/);
  });

  test.each([
    'https://cloud.comfy.org',
    'https://cloud.comfy.org:443/',
    'https://api.comfy.org',
    'https://my-app.run.comfy.app',
  ])('refuses Comfy-hosted surfaces (%s)', (raw) => {
    expect(() => assertLocalBaseUrl(raw)).toThrow(/Comfy-hosted/);
  });

  test.each(['ftp://127.0.0.1:8189', 'http://127.0.0.1:8189/?x=1', 'not a url'])('refuses a malformed URL (%s)', (raw) => {
    expect(() => assertLocalBaseUrl(raw)).toThrow();
  });
});

describe('guardFetch', () => {
  const base = new URL('http://127.0.0.1:8189');

  test('forwards same-origin requests', async () => {
    const calls: string[] = [];
    const inner = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('ok');
    }) as typeof fetch;
    const res = await guardFetch(base, inner)('http://127.0.0.1:8189/api/v2/health');
    expect(await res.text()).toBe('ok');
    expect(calls).toEqual(['http://127.0.0.1:8189/api/v2/health']);
  });

  test('refuses any other origin before a request is made', async () => {
    let called = false;
    const inner = (async () => {
      called = true;
      return new Response('');
    }) as typeof fetch;
    await expect(guardFetch(base, inner)('https://cloud.comfy.org/api/v2/jobs')).rejects.toThrow(/refused/);
    expect(called).toBe(false);
  });
});

describe('checkWorkflow against /object_info', () => {
  const info = {
    WanCameraEmbedding: {
      input: {
        // V3 nodes describe a combo as ["COMBO", { options }]
        required: { camera_pose: ['COMBO', { options: ['Static', 'Zoom In', 'Pan Left'] }], width: ['INT', {}] },
        optional: { speed: ['FLOAT', {}] },
      },
    },
    // legacy nodes describe a combo as [[...options], {}]
    UNETLoader: { input: { required: { unet_name: [['a.safetensors'], {}], weight_dtype: [['default'], {}] } } },
    LoadImage: { input: { required: { image: [['start.png'], {}] } } },
  };

  test('reads both combo shapes', () => {
    expect(comboOptions(info.WanCameraEmbedding.input.required.camera_pose)).toEqual(['Static', 'Zoom In', 'Pan Left']);
    expect(comboOptions(info.UNETLoader.input.required.unet_name)).toEqual(['a.safetensors']);
    expect(comboOptions(info.WanCameraEmbedding.input.required.width)).toBeNull();
  });

  test('reports a missing node class, an unknown combo value and a missing weight file', () => {
    const workflow = {
      '1': { class_type: 'WanCameraEmbedding', inputs: { camera_pose: 'Zoom In + Pan Left', width: 832, speed: 1.5 } },
      '2': { class_type: 'UNETLoader', inputs: { unet_name: 'b.safetensors', weight_dtype: 'default' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'uploaded-later.png' } },
      '4': { class_type: 'KlingImage2VideoNode', inputs: { start: ['3', 0] } },
    };
    const problems = checkWorkflow(workflow, info, { skip: ['3.image'] });
    expect(problems).toEqual([
      expect.stringMatching(/node 1 \(WanCameraEmbedding\)\.camera_pose = "Zoom In \+ Pan Left".*Static, Zoom In, Pan Left/),
      expect.stringMatching(/node 2 \(UNETLoader\)\.unet_name = "b\.safetensors"/),
      expect.stringMatching(/node 4: class KlingImage2VideoNode is not installed/),
    ]);
  });

  test('a valid workflow has no problem', () => {
    const workflow = { '1': { class_type: 'WanCameraEmbedding', inputs: { camera_pose: 'Zoom In', width: 832 } } };
    expect(checkWorkflow(workflow, info)).toEqual([]);
  });
});

describe('checkWorkflow: input names, required inputs and links', () => {
  const info = {
    UNETLoader: { input: { required: { unet_name: [['a.safetensors'], {}] } }, output: ['MODEL'] },
    ModelSamplingSD3: { input: { required: { model: ['MODEL'], shift: ['FLOAT', { default: 3 }] } }, output: ['MODEL'] },
    WanCameraEmbedding: {
      input: { required: { camera_pose: ['COMBO', { options: ['Static'] }], width: ['INT', {}] }, optional: { speed: ['FLOAT', {}] } },
      output: ['WAN_CAMERA_EMBEDDING', 'INT', 'INT', 'INT'],
    },
    WanCameraImageToVideo: {
      input: { required: { width: ['INT', {}] }, optional: { camera_conditions: ['WAN_CAMERA_EMBEDDING', {}] } },
      output: ['CONDITIONING', 'CONDITIONING', 'LATENT'],
    },
    PreviewAny: { input: { required: { source: ['*', {}] } }, output: [] },
  };
  const valid = () => ({
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors' } },
    '2': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    '3': { class_type: 'WanCameraEmbedding', inputs: { camera_pose: 'Static', width: 832 } },
    '4': { class_type: 'WanCameraImageToVideo', inputs: { width: ['3', 1], camera_conditions: ['3', 0] } },
  });

  test('a workflow whose links and inputs all match has no problem', () => {
    expect(checkWorkflow(valid(), info)).toEqual([]);
  });

  test('an input filled by a link may be a widget input', () => {
    const workflow = valid();
    expect(workflow['4'].inputs.width).toEqual(['3', 1]);
    expect(checkWorkflow(workflow, info)).toEqual([]);
  });

  test('reports an input the class does not declare', () => {
    const workflow = valid();
    (workflow['2'].inputs as Record<string, unknown>).seed = 3;
    expect(checkWorkflow(workflow, info)).toEqual(['node 2 (ModelSamplingSD3): unknown input "seed"']);
  });

  test('reports a missing required input', () => {
    const workflow = valid();
    delete (workflow['2'].inputs as Record<string, unknown>).shift;
    expect(checkWorkflow(workflow, info)).toEqual(['node 2 (ModelSamplingSD3): missing required input "shift"']);
  });

  test('reports a link to a node that is not in the workflow', () => {
    const workflow = valid();
    workflow['2'].inputs.model = ['9', 0];
    expect(checkWorkflow(workflow, info)).toEqual(['node 2 (ModelSamplingSD3).model links to missing node "9"']);
  });

  test('reports a link to an output the node does not have', () => {
    const workflow = valid();
    workflow['2'].inputs.model = ['1', 1];
    expect(checkWorkflow(workflow, info)).toEqual(['node 2 (ModelSamplingSD3).model links to output 1 of node 1 (UNETLoader), which has 1 output(s)']);
  });

  test('reports a link whose output type is not the input type', () => {
    const workflow = valid();
    workflow['4'].inputs.camera_conditions = ['3', 2];
    expect(checkWorkflow(workflow, info)).toEqual([
      'node 4 (WanCameraImageToVideo).camera_conditions expects WAN_CAMERA_EMBEDDING, output 2 of node 3 is INT',
    ]);
  });

  test('an input typed * accepts any output', () => {
    const workflow = { ...valid(), '5': { class_type: 'PreviewAny', inputs: { source: ['3', 3] } } };
    expect(checkWorkflow(workflow, info)).toEqual([]);
  });

  test('skip still skips combo checks only', () => {
    const workflow = valid();
    (workflow['1'].inputs as Record<string, unknown>).unet_name = 'later.safetensors';
    expect(checkWorkflow(workflow, info, { skip: ['1.unet_name'] })).toEqual([]);
    delete (workflow['1'].inputs as Record<string, unknown>).unet_name;
    expect(checkWorkflow(workflow, info, { skip: ['1.unet_name'] })).toEqual(['node 1 (UNETLoader): missing required input "unet_name"']);
  });
});

describe('checkWorkflow: dynamic combos (SaveVideo format and codec)', () => {
  // the shape ComfyUI v0.41.0 gives in /object_info for io.DynamicCombo inputs
  const codec = (keys: string[]) => ['COMFY_DYNAMICCOMBO_V3', { options: keys.map((key) => ({ key, inputs: { required: {} } })) }];
  const info = {
    LoadImage: { input: { required: { image: [['start.png'], {}] } }, output: ['IMAGE', 'MASK'] },
    CreateVideo: { input: { required: { images: ['IMAGE', {}], fps: ['FLOAT', {}] } }, output: ['VIDEO'] },
    SaveVideo: {
      input: {
        required: {
          video: ['VIDEO', {}],
          filename_prefix: ['STRING', {}],
          format: [
            'COMFY_DYNAMICCOMBO_V3',
            {
              options: [
                { key: 'auto', inputs: { required: { codec: codec(['auto', 'h264', 'av1']) } } },
                { key: 'mp4', inputs: { required: { codec: codec(['auto', 'h264', 'av1']) } } },
                { key: 'webm', inputs: { required: { codec: codec(['auto', 'av1']) } } },
              ],
            },
          ],
        },
        optional: { codec: codec(['auto', 'h264', 'av1']) },
      },
      output: ['VIDEO'],
    },
  };
  const workflow = (save: Record<string, unknown>) => ({
    '1': { class_type: 'LoadImage', inputs: { image: 'start.png' } },
    '2': { class_type: 'CreateVideo', inputs: { images: ['1', 0], fps: 16 } },
    '3': { class_type: 'SaveVideo', inputs: { video: ['2', 0], filename_prefix: 'montagio/clip', ...save } },
  });

  test('reads the options of a dynamic combo', () => {
    expect(comboOptions(info.SaveVideo.input.required.format)).toEqual(['auto', 'mp4', 'webm']);
  });

  test('a dynamic combo and the input nested under its option are accepted', () => {
    expect(checkWorkflow(workflow({ format: 'mp4', 'format.codec': 'h264' }), info)).toEqual([]);
    expect(checkWorkflow(workflow({ format: 'mp4', codec: 'h264' }), info)).toEqual([]);
  });

  test('an option a dynamic combo does not have is reported', () => {
    expect(checkWorkflow(workflow({ format: 'mov', 'format.codec': 'h264' }), info)).toEqual([
      'node 3 (SaveVideo).format = "mov" is not one of: auto, mp4, webm',
    ]);
  });

  test('a nested value the selected option does not offer is reported', () => {
    expect(checkWorkflow(workflow({ format: 'webm', 'format.codec': 'h264' }), info)).toEqual([
      'node 3 (SaveVideo).format.codec = "h264" is not one of: auto, av1',
    ]);
  });

  test('a nested input the selected option does not declare is unknown', () => {
    expect(checkWorkflow(workflow({ format: 'mp4', 'format.colour': 'red' }), info)).toEqual([
      'node 3 (SaveVideo): unknown input "format.colour"',
    ]);
  });
});

test('parseNvidiaSmiLine reads used and total MiB', () => {
  expect(parseNvidiaSmiLine('20480, 24564')).toEqual({ usedMiB: 20480, totalMiB: 24564 });
  expect(parseNvidiaSmiLine('garbage')).toBeNull();
});
