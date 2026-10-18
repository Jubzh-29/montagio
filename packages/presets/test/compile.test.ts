import { readFileSync } from 'node:fs';
import { parseModel, type ModelEntry } from '@montagio/registry';
import {
  CAMERA_POSE_VALUES,
  COMBINED_CAMERA_NODE,
  compileJob,
  CompileError,
  dimensionsFor,
  frameCount,
  parsePreset,
  pickAspect,
  type ApiWorkflow,
} from '../src/index';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const preset = parsePreset(read('crash-push.yaml'), 'crash-push.yaml');
const funCamera = parseModel(read('wan-fun-camera.yaml'), 'wan-fun-camera.yaml');
const wan5b = parseModel(read('wan-5b.yaml'), 'wan-5b.yaml');
const template = JSON.parse(read('workflow-template.api.json')) as ApiWorkflow;
const template5b = JSON.parse(read('workflow-template-5b.api.json')) as ApiWorkflow;
const funCamera480only: ModelEntry = { ...funCamera, limits: { ...funCamera.limits, resolutions: ['480p'] } };

test.each([
  [5, 16, 81],
  [2, 16, 33],
  [10, 24, 241],
  [5, 24, 121],
])('frameCount(%i, %i) = %i', (d, f, n) => expect(frameCount(d, f)).toBe(n));

test.each([
  [1920, 1080, '16:9'],
  [1080, 1920, '9:16'],
  [1000, 1000, '1:1'],
  [4000, 500, '16:9'],
  [500, 4000, '9:16'],
  [1400, 1000, '16:9'],
  [710, 1000, '9:16'],
  [1300, 1000, '1:1'],
])('pickAspect(%i, %i) = %s', (w, h, a) => expect(pickAspect(w, h)).toBe(a));

test('dimensions table', () => {
  expect(dimensionsFor('16:9', '480p')).toEqual({ width: 832, height: 480 });
  expect(dimensionsFor('9:16', '720p')).toEqual({ width: 720, height: 1280 });
  expect(dimensionsFor('1:1', '480p')).toEqual({ width: 640, height: 640 });
  expect(dimensionsFor('1:1', '720p')).toEqual({ width: 960, height: 960 });
});

test('parametric compile writes bindings and keeps the template intact', () => {
  const before = structuredClone(template);
  const { workflow, params } = compileJob(preset, funCamera, template, {
    imageRef: 'uploads/a.png',
    userPrompt: ' a cat on a sofa ',
    seed: 42,
    aspect: '16:9',
  });
  expect(workflow['12']?.inputs.camera_pose).toBe('Zoom In');
  expect(workflow['12']?.inputs.speed).toBe(1.5);
  expect(workflow['12']?.inputs.length).toBe(81);
  expect(workflow['3']?.inputs.image).toBe('uploads/a.png');
  expect(workflow['6']?.inputs.text).toBe('a cat on a sofa, dynamic camera push-in, cinematic, sharp focus on subject');
  expect(workflow['7']?.inputs.text).toBe('blurry, distorted, extra limbs');
  expect(workflow['10']?.inputs.seed).toBe(42);
  expect(params).toMatchObject({ frames: 81, width: 832, height: 480, fps: 16, cameraMode: 'parametric', seed: 42 });
  expect(template).toEqual(before);
});

const withPoses = (poses: string, combine?: string) =>
  parsePreset(
    read('crash-push.yaml').replace('poses: [zoom_in]', `poses: ${poses}${combine ? `\n  combine: ${combine}` : ''}`),
    'combo.yaml',
  );

test('a single pose keeps the core camera node', () => {
  const { workflow, params } = compileJob(preset, funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(workflow['12']?.class_type).toBe('WanCameraEmbedding');
  expect(Object.keys(workflow['12']!.inputs)).not.toContain('camera_pose_2');
  expect(Object.keys(workflow['12']!.inputs)).not.toContain('combine');
  expect(params).toMatchObject({ cameraPose: 'Zoom In', cameraPose2: null, cameraCombine: null });
});

test('two poses swap the camera node for Montagio Camera Embedding', () => {
  const before = structuredClone(template);
  const { workflow, params } = compileJob(withPoses('[pan_up, zoom_in]'), funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(COMBINED_CAMERA_NODE).toBe('MontagioCameraEmbedding');
  expect(workflow['12']).toEqual({
    class_type: 'MontagioCameraEmbedding',
    inputs: { ...template['12']!.inputs, camera_pose: 'Pan Up', camera_pose_2: 'Zoom In', combine: 'together', speed: 1.5, width: 832, height: 480, length: 81 },
  });
  expect(params).toMatchObject({ cameraPose: 'Pan Up', cameraPose2: 'Zoom In', cameraCombine: 'together', cameraSpeed: 1.5 });
  expect(template).toEqual(before);
});

test('a single pose on a template that already has Montagio Camera Embedding resets its second move', () => {
  const t = structuredClone(template);
  t['12'] = { class_type: COMBINED_CAMERA_NODE, inputs: { ...t['12']!.inputs, camera_pose_2: 'Pan Left', combine: 'then' } };
  const { workflow, params } = compileJob(preset, funCamera, t, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(workflow['12']?.class_type).toBe(COMBINED_CAMERA_NODE);
  expect(workflow['12']?.inputs).toMatchObject({ camera_pose: 'Zoom In', camera_pose_2: 'Static', combine: 'together' });
  expect(params).toMatchObject({ cameraPose: 'Zoom In', cameraPose2: null, cameraCombine: null });
});

test('then is passed to the node', () => {
  const { workflow, params } = compileJob(withPoses('[zoom_in, static]', 'then'), funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(workflow['12']?.inputs).toMatchObject({ camera_pose: 'Zoom In', camera_pose_2: 'Static', combine: 'then' });
  expect(params.cameraCombine).toBe('then');
});

test('a combined move on a bound node that is not a camera node is refused', () => {
  const t = structuredClone(template);
  t['12'] = { class_type: 'PrimitiveString', inputs: { camera_pose: 'Static', speed: 1, width: 832, height: 480, length: 81 } };
  expect(() => compileJob(withPoses('[pan_up, zoom_in]'), funCamera, t, { imageRef: 'u.png', seed: 1, aspect: '16:9' })).toThrow(
    /combines 2 camera moves.*node 12 is PrimitiveString, not a camera node/,
  );
});

test('prompt mode chains the words with then', () => {
  const { params } = compileJob(withPoses('[zoom_in, static]', 'then'), wan5b, template5b, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(params.prompt).toBe(
    'dynamic camera push-in, cinematic, sharp focus on subject, the camera pushes in toward the subject, then static locked-off camera',
  );
  expect(params).toMatchObject({ cameraMode: 'prompt', cameraPose: null, cameraPose2: null, cameraCombine: null });
});

test.each([
  ['roll_ccw', 'Anti Clockwise (ACW)', 'the camera rolls counterclockwise'],
  ['roll_cw', 'ClockWise (CW)', 'the camera rolls clockwise'],
])('the roll %s reaches the camera node as "%s" and the prompt as "%s"', (pose, value, words) => {
  const roll = withPoses(`[${pose}]`);
  expect(compileJob(roll, funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' }).workflow['12']?.inputs.camera_pose).toBe(value);
  expect(compileJob(roll, wan5b, template5b, { imageRef: 'u.png', seed: 1, aspect: '16:9' }).params.prompt.endsWith(words)).toBe(true);
});

test('every camera_pose of WanCameraEmbedding is reachable from a preset', () => {
  // ComfyUI v0.41.0, comfy_extras/nodes_camera_trajectory.py
  expect(Object.values(CAMERA_POSE_VALUES).sort()).toEqual(
    ['Static', 'Pan Up', 'Pan Down', 'Pan Left', 'Pan Right', 'Zoom In', 'Zoom Out', 'Anti Clockwise (ACW)', 'ClockWise (CW)'].sort(),
  );
});

test('prompt mode joins moves that happen together with a comma', () => {
  const { params } = compileJob(withPoses('[pan_up, zoom_in]'), wan5b, template5b, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(params.prompt.endsWith('the camera tilts up, the camera pushes in toward the subject')).toBe(true);
});

test('prompt mode for a model without camera control', () => {
  const { params, workflow } = compileJob(preset, wan5b, template5b, { imageRef: 'uploads/a.png', seed: 1, aspect: '1:1' });
  expect(params.cameraMode).toBe('prompt');
  expect(params.cameraPose).toBeNull();
  expect(params.prompt).toBe(
    'dynamic camera push-in, cinematic, sharp focus on subject, the camera pushes in toward the subject',
  );
  expect(workflow['20']?.inputs).toMatchObject({ width: 640, height: 640 });
});

test('a preset default fps the model cannot render falls back to the model fps', () => {
  const { params } = compileJob(preset, wan5b, template5b, { imageRef: 'u.png', seed: 1, aspect: '16:9' });
  expect(params.fps).toBe(24);
  expect(params.frames).toBe(121);
});

test('an explicit fps the model cannot render is refused', () => {
  expect(() => compileJob(preset, wan5b, template5b, { imageRef: 'u.png', seed: 1, aspect: '16:9', fps: 16 })).toThrow(
    /fps/,
  );
});

test('720p refused when the model only allows 480p', () => {
  expect(() =>
    compileJob(preset, funCamera480only, template, { imageRef: 'u.png', seed: 1, aspect: '16:9', resolution: '720p' }),
  ).toThrow(/720p/);
});

test('an explicit duration above the model limit is refused', () => {
  expect(() =>
    compileJob(preset, funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9', duration_s: 8 }),
  ).toThrow(CompileError);
});

test('missing template node is reported', () => {
  const t = structuredClone(template);
  delete t['12'];
  expect(() => compileJob(preset, funCamera, t, { imageRef: 'u.png', seed: 1, aspect: '16:9' })).toThrow(
    /camera_pose.*12/,
  );
});

test('i2v without image is refused', () => {
  expect(() => compileJob(preset, funCamera, template, { seed: 1, aspect: '16:9' })).toThrow(CompileError);
});

test('a preset with LoRAs is refused instead of silently ignoring them', () => {
  const withLora = parsePreset(
    `${read('crash-push.yaml')}loras:\n  - { file: style.safetensors, strength: 0.8 }\n`,
    'lora.yaml',
  );
  expect(() => compileJob(withLora, funCamera, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' })).toThrow(
    /LoRA/,
  );
});

test('an image-only model is refused for a camera preset', () => {
  const t2i: ModelEntry = { ...funCamera, kind: 'image', capabilities: ['t2i'] };
  expect(() => compileJob(preset, t2i, template, { imageRef: 'u.png', seed: 1, aspect: '16:9' })).toThrow(
    CompileError,
  );
});
