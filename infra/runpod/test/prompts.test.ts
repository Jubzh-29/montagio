import { readFileSync } from 'node:fs';
import { negativeOverride, WAN_DEFAULT_NEGATIVE } from '../lib/prompts';

test('negativeOverride: "wan" is the templates\' default negative, a text is kept, nothing stays nothing', () => {
  expect(negativeOverride(undefined)).toBeUndefined();
  expect(negativeOverride(' wan ')).toBe(WAN_DEFAULT_NEGATIVE);
  expect(negativeOverride(' blurry, static ')).toBe('blurry, static');
  expect(() => negativeOverride('  ')).toThrow(/needs a text/);
});

test('the default negative is the one the transitions template still carries', () => {
  // workflows/wan22-flf2v-transition.api.json kept its template negative: the same Wan text.
  const workflow = JSON.parse(readFileSync(new URL('../../../workflows/wan22-flf2v-transition.api.json', import.meta.url), 'utf8')) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  const texts = Object.values(workflow)
    .filter((node) => node.class_type === 'CLIPTextEncode')
    .map((node) => node.inputs.text);
  expect(texts).toContain(WAN_DEFAULT_NEGATIVE);
});
