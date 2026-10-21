import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModel } from '@montagio/registry';
import { CompileError, compileImage, IMAGE_PROMPT_MAX, IMAGE_STYLES, parseImageStyle, styledPrompt, type ApiWorkflow } from '../src/index';

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const zimage = parseModel(readFileSync(repo('registry/models/z-image-turbo.yaml'), 'utf8'), 'z-image-turbo.yaml');
const template = JSON.parse(readFileSync(repo('workflows/z-image-turbo.api.json'), 'utf8')) as ApiWorkflow;
const wan5b = parseModel(readFileSync(repo('registry/models/wan22-ti2v-5b.yaml'), 'utf8'), 'wan22-ti2v-5b.yaml');

test('z-image-turbo, 16:9: 1280x720, the prompt in node 27, the seed in node 3', () => {
  const { workflow, params } = compileImage(zimage, template, { prompt: '  a red fox in the snow  ', seed: 42, aspect: '16:9' });
  expect(workflow['27']!.inputs.text).toBe('a red fox in the snow');
  expect(workflow['3']!.inputs.seed).toBe(42);
  expect(workflow['13']!.inputs).toMatchObject({ width: 1280, height: 720 });
  expect(params).toEqual({ width: 1280, height: 720, prompt: 'a red fox in the snow', seed: 42, resolution: '720p' });
});

test('9:16 and 1:1 sizes, and 480p when asked', () => {
  expect(compileImage(zimage, template, { prompt: 'x', seed: 1, aspect: '9:16' }).params).toMatchObject({ width: 720, height: 1280 });
  expect(compileImage(zimage, template, { prompt: 'x', seed: 1, aspect: '1:1' }).params).toMatchObject({ width: 960, height: 960 });
  expect(compileImage(zimage, template, { prompt: 'x', seed: 1, aspect: '16:9', resolution: '480p' }).params).toMatchObject({ width: 832, height: 480 });
});

test('the output is node 9, an image', () => {
  expect(compileImage(zimage, template, { prompt: 'x', seed: 1, aspect: '16:9' }).output).toEqual({ kind: 'image', node: '9' });
});

test('a template with no image saver, or two, is refused', () => {
  const none: ApiWorkflow = structuredClone(template);
  delete none['9'];
  expect(() => compileImage(zimage, none, { prompt: 'x', seed: 1, aspect: '16:9' })).toThrow(CompileError);
  const two: ApiWorkflow = { ...structuredClone(template), '99': { class_type: 'SaveImage', inputs: {} } };
  expect(() => compileImage(zimage, two, { prompt: 'x', seed: 1, aspect: '16:9' })).toThrow(/SaveImage/);
});

test('a video model is refused', () => {
  expect(() => compileImage(wan5b, template, { prompt: 'x', seed: 1, aspect: '16:9' })).toThrow(/t2i/);
});

test('an empty or too long prompt is refused', () => {
  expect(IMAGE_PROMPT_MAX).toBe(500);
  expect(() => compileImage(zimage, template, { prompt: '   ', seed: 1, aspect: '16:9' })).toThrow(CompileError);
  expect(() => compileImage(zimage, template, { prompt: 'x'.repeat(501), seed: 1, aspect: '16:9' })).toThrow(CompileError);
  expect(() => compileImage(zimage, template, { prompt: 'x'.repeat(500), seed: 1, aspect: '16:9' })).not.toThrow();
});

test('the template is not mutated', () => {
  const before = JSON.stringify(template);
  compileImage(zimage, template, { prompt: 'a fox', seed: 9, aspect: '9:16' });
  expect(JSON.stringify(template)).toBe(before);
});

test('the cinematography chips add their phrases after the text, in group order', () => {
  const { workflow, params } = compileImage(zimage, template, {
    prompt: 'a red fox in the snow.',
    seed: 1,
    aspect: '16:9',
    style: { light: 'golden', lens: 'portrait' },
  });
  expect(params.prompt).toBe(`a red fox in the snow. ${IMAGE_STYLES.lens.portrait}, ${IMAGE_STYLES.light.golden}.`);
  expect(workflow['27']!.inputs.text).toBe(params.prompt);
  expect(styledPrompt('  a fox  ')).toBe('a fox');
});

test('a style holds known choices only', () => {
  expect(parseImageStyle(undefined)).toEqual({});
  expect(parseImageStyle({ camera: 'drone', film: '' })).toEqual({ camera: 'drone' });
  expect(parseImageStyle({ camera: 'brand-x' })).toBeNull();
  expect(parseImageStyle({ weather: 'rain' })).toBeNull();
  expect(parseImageStyle(['drone'])).toBeNull();
  expect(parseImageStyle({ lens: 'toString' })).toBeNull();
});
