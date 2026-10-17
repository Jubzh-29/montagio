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

test('parseNvidiaSmiLine reads used and total MiB', () => {
  expect(parseNvidiaSmiLine('20480, 24564')).toEqual({ usedMiB: 20480, totalMiB: 24564 });
  expect(parseNvidiaSmiLine('garbage')).toBeNull();
});
