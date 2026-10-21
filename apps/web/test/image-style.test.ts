import { IMAGE_STYLES } from '@montagio/presets';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import { RELIGHTS, relightInstruction, relightKey, STYLE_CHOICES, STYLE_GROUPS, styleBody, styleChoiceKey, styleGroupKey } from '@/lib/image-style';

test("the browser's chips are exactly the server's choices", () => {
  expect(STYLE_GROUPS).toEqual(Object.keys(IMAGE_STYLES));
  for (const group of STYLE_GROUPS) expect([...STYLE_CHOICES[group]]).toEqual(Object.keys(IMAGE_STYLES[group]));
});

test('every chip and relight has its label in English and in French', () => {
  const keys = [
    ...STYLE_GROUPS.map(styleGroupKey),
    ...STYLE_GROUPS.flatMap((group) => STYLE_CHOICES[group].map((choice) => styleChoiceKey(group, choice))),
    ...RELIGHTS.map(relightKey),
  ];
  for (const key of keys) {
    expect(en, key).toHaveProperty([key]);
    expect(fr, key).toHaveProperty([key]);
  }
});

test('a request sends the chosen groups only', () => {
  expect(styleBody({ camera: '', lens: 'macro' })).toEqual({ lens: 'macro' });
});

test('a relight keeps the photo and changes the light only', () => {
  for (const relight of RELIGHTS) expect(relightInstruction(relight)).toMatch(/^Relight the photo with .+ Keep the people, the objects, the framing and the composition exactly the same\.$/);
});
