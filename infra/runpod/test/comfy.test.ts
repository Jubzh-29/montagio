import { readFileSync } from 'node:fs';
import type { ApiWorkflow } from '@montagio/presets';
import { assertLocalBaseUrl, cameraMove, checkWorkflow, comboOptions, guardFetch, parseNvidiaSmiLine, type ObjectInfo } from '../lib/comfy';

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

describe('checkWorkflow: what ComfyUI v0.41.0 validates in the inputs of an option, bounds and list outputs', () => {
  // SaveVideo as the real /object_info gives it: format → codec → encoding, whose "re-encode" option requires crf (0 to 51 in H.264)
  const real = JSON.parse(readFileSync(new URL('./fixtures/object_info-v0.41.0.json', import.meta.url), 'utf8')) as ObjectInfo;
  const info: ObjectInfo = {
    SaveVideo: real.SaveVideo!,
    WanCameraEmbedding: real.WanCameraEmbedding!,
    VideoSource: { input: { required: {} }, output: ['VIDEO'] },
    // a legacy node may give the option list of a combo as the type of an output
    PoseList: { input: { required: {} }, output: [['Static', 'Zoom In']], output_name: ['pose'] },
    CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }] } }, output: ['CONDITIONING'] },
  };
  const camera = { camera_pose: 'Zoom In', width: 832, height: 480, length: 81, speed: 1.5 };
  const save = (inputs: Record<string, unknown>) => ({
    '1': { class_type: 'WanCameraEmbedding', inputs: camera },
    '2': { class_type: 'SaveVideo', inputs: { video: ['8', 0], filename_prefix: 'montagio/clip', format: 'mp4', 'format.codec': 'h264', ...inputs } },
    '8': { class_type: 'VideoSource', inputs: {} },
  });

  test('a required input of the option a dynamic combo selected is reported when missing', () => {
    expect(checkWorkflow(save({ 'format.codec.encoding': 're-encode' }), info)).toEqual([
      'node 2 (SaveVideo): missing required input "format.codec.encoding.crf"',
    ]);
    expect(checkWorkflow(save({ 'format.codec.encoding': 're-encode', 'format.codec.encoding.crf': 18 }), info)).toEqual([]);
  });

  test('a nested dynamic combo left out of the workflow requires nothing: ComfyUI leaves it out of the schema', () => {
    const workflow = save({});
    delete (workflow['2'].inputs as Record<string, unknown>)['format.codec'];
    expect(checkWorkflow(workflow, info)).toEqual([]);
  });

  test('a value below the min or above the max is reported, nested inputs included', () => {
    const workflow = save({ 'format.codec.encoding': 're-encode', 'format.codec.encoding.crf': 60 });
    workflow['1'].inputs = { ...camera, width: 8, speed: 12 };
    expect(checkWorkflow(workflow, info)).toEqual([
      'node 1 (WanCameraEmbedding).width = 8 is below the min of 16',
      'node 1 (WanCameraEmbedding).speed = 12 is above the max of 10',
      'node 2 (SaveVideo).format.codec.encoding.crf = 60 is above the max of 51',
    ]);
  });

  test('an output typed as a list of options goes into a combo input, not into another type', () => {
    const workflow: ApiWorkflow = {
      '1': { class_type: 'WanCameraEmbedding', inputs: { ...camera, camera_pose: ['9', 0] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: ['9', 0] } },
      '9': { class_type: 'PoseList', inputs: {} },
    };
    expect(checkWorkflow(workflow, info)).toEqual(['node 3 (CLIPTextEncode).text expects STRING, output 0 of node 9 is a list of 2 options']);
  });
});

test.each([
  [{ cameraPose: 'Zoom In', cameraPose2: null, cameraCombine: null }, 'Zoom In'],
  [{ cameraPose: 'Pan Up', cameraPose2: 'Zoom In', cameraCombine: 'together' as const }, 'Pan Up + Zoom In'],
  [{ cameraPose: 'Zoom In', cameraPose2: 'Static', cameraCombine: 'then' as const }, 'Zoom In, then Static'],
  [{ cameraPose: null, cameraPose2: null, cameraCombine: null }, null],
])('cameraMove names the move of a compiled job: %o', (params, label) => {
  expect(cameraMove(params)).toBe(label);
});

test('parseNvidiaSmiLine reads used and total MiB', () => {
  expect(parseNvidiaSmiLine('20480, 24564')).toEqual({ usedMiB: 20480, totalMiB: 24564 });
  expect(parseNvidiaSmiLine('garbage')).toBeNull();
});
