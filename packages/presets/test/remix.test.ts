import { fileURLToPath } from 'node:url';
import { cleanHashtags, CompileError, compileTrendSkeleton, loadLibrary, parseTrendSkeleton, trendPostInstruction, type Library } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

let lib: Library;
beforeAll(async () => {
  lib = await loadLibrary(repoRoot);
});

const skeleton = () => {
  const model = lib.extensionModels.get('gemma4-trend-skeleton');
  if (!model) throw new Error('no extension model gemma4-trend-skeleton');
  return { model, template: lib.extensionTemplates.get(model.workflow)! };
};

describe('compileTrendSkeleton (Gemma 4 E4B reads the shots, then writes the post)', () => {
  test('the sheet goes to the image loader, the instruction before the skeleton in the second pass', () => {
    const { workflow, params } = compileTrendSkeleton(skeleton().model, skeleton().template, { sheetRef: 'sheet.png', character: ' a cartoon boy in a green jacket ', language: 'fr' });
    expect(workflow['1']!.inputs.image).toBe('sheet.png');
    expect(workflow['3']!.inputs.image).toEqual(['1', 0]);
    expect(workflow['4']!.inputs.string_a).toBe(trendPostInstruction({ character: 'a cartoon boy in a green jacket', language: 'fr' }));
    expect(workflow['4']!.inputs.string_b).toEqual(['3', 0]);
    expect(workflow['5']!.inputs.prompt).toEqual(['4', 0]);
    expect(workflow['7']!.class_type).toBe('SaveText');
    expect(params).toEqual({ language: 'fr', character: 'a cartoon boy in a green jacket' });
  });

  test('the instruction says who performs the shots, the language, and never a real person or brand', () => {
    const fr = trendPostInstruction({ character: 'a robot', language: 'fr' });
    expect(fr).toMatch(/in which a robot performs the same shots/);
    expect(fr).toMatch(/sentences in French/);
    expect(fr).toMatch(/Never name a real person or a brand/);
    expect(trendPostInstruction({ language: 'en' })).toMatch(/in which a new character performs/);
  });

  test('another language, or a description too long, is refused', () => {
    const { model, template } = skeleton();
    expect(() => compileTrendSkeleton(model, template, { sheetRef: 's.png', language: 'de' as 'fr' })).toThrow(CompileError);
    expect(() => compileTrendSkeleton(model, template, { sheetRef: 's.png', character: 'x'.repeat(201), language: 'en' })).toThrow(/over the 200/);
  });
});

describe('parseTrendSkeleton (the two answers, as Gemma gives them)', () => {
  test('two JSON answers, one wrapped in a code fence and a sentence', () => {
    const file = [
      '{"shots": ["a woman waves at the camera", "she spins", "close-up, she winks"], "hook": "POV: Monday", "style": "playful, fast"}',
      '=====',
      'Here is the post:\n```json\n{"caption": "Lundi, version robot.", "hashtags": ["#trend", "dance", "#Trend", "fyp ", "pov"], "onscreen": "POV : lundi"}\n```',
    ].join('\n');
    expect(parseTrendSkeleton(file)).toEqual({
      skeleton: { shots: ['a woman waves at the camera', 'she spins', 'close-up, she winks'], hook: 'POV: Monday', style: 'playful, fast' },
      post: { caption: 'Lundi, version robot.', hashtags: ['trend', 'dance', 'fyp', 'pov'], onscreen: 'POV : lundi' },
    });
  });

  test('what cannot be read comes back empty, never thrown', () => {
    expect(parseTrendSkeleton('no json here')).toEqual({
      skeleton: { shots: [], hook: '', style: '' },
      post: { caption: '', hashtags: [], onscreen: '' },
    });
    expect(parseTrendSkeleton('{"shots": "not a list", "hook": 3}\n=====\n{broken')).toEqual({
      skeleton: { shots: [], hook: '', style: '' },
      post: { caption: '', hashtags: [], onscreen: '' },
    });
  });

  test('hashtags lose their # and spaces, each once, eight at most', () => {
    expect(cleanHashtags(['#a', 'b c', 'A', '', 3, '##d', 'e', 'f', 'g', 'h', 'i', 'j'])).toEqual(['a', 'bc', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(cleanHashtags('not a list')).toEqual([]);
  });
});
