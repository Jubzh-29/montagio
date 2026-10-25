import { readFileSync } from 'node:fs';
import {
  enabledExtensions,
  extensionEstimate,
  modelInProfile,
  parseExtensionModel,
  parseExtensionsConfig,
  parseModel,
  RegistryError,
  vramProfile,
} from '../src/index';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const camera = read('wan-fun-camera.yaml');
const music = read('ext-music.yaml');
const config = read('extensions.yaml');
const replaceOnce = (text: string, from: string | RegExp, to: string) => {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`fixture does not contain ${String(from)}`);
  return out;
};
const lowVram = (validated: string) => `${camera}low_vram:\n  gpu_validated: ${validated}\n  estimate_s:\n    480p: 120\n`;

test.each([undefined, '', ' standard '])('MONTAGIO_VRAM_PROFILE %j is the 24 GB profile', (flag) => {
  expect(vramProfile(flag)).toBe('standard');
});

test('"12gb" is the 12 GB profile; anything else is refused', () => {
  expect(vramProfile('12gb')).toBe('12gb');
  expect(() => vramProfile('8gb')).toThrow(RegistryError);
});

test('a camera model is offered in the 12 GB profile once a GPU held to 12 GB ran it, with its times there', () => {
  const plain = parseModel(camera, 'm.yaml');
  expect(modelInProfile(plain, 'standard')).toBe(plain);
  expect(modelInProfile(plain, '12gb')).toBeNull();
  expect(modelInProfile(parseModel(lowVram('null'), 'm.yaml'), '12gb')).toBeNull();
  const validated = parseModel(lowVram('2026-10-25'), 'm.yaml');
  expect(modelInProfile(validated, '12gb')?.estimate_s).toEqual({ '480p': 120 });
  expect(modelInProfile(validated, 'standard')?.estimate_s).toEqual({ '480p': 90, '720p': 240 });
  expect(() => parseModel(lowVram('yesterday'), 'm.yaml')).toThrow(/date/);
});

test("an extension model's time in the 12 GB profile is its measure there, when it has one", () => {
  const plain = parseExtensionModel(music, 'm.yaml');
  const measured = parseExtensionModel(`${music}low_vram:\n  estimate_s: 44\n`, 'm.yaml');
  expect(extensionEstimate(plain, '12gb')).toBe(plain.estimate_s);
  expect(extensionEstimate(measured, '12gb')).toBe(44);
  expect(extensionEstimate(measured, 'standard')).toBe(plain.estimate_s);
});

describe('enabledExtensions in the 12 GB profile', () => {
  test('nothing until a GPU held to 12 GB ran an extension: low_vram_validated is null by default', () => {
    expect(enabledExtensions(parseExtensionsConfig(config, 'e.yaml'), undefined, '12gb')).toEqual([]);
  });
  test('validated means run within 12 GB, and the requirements still hold', () => {
    const effects = replaceOnce(config, 'priority: 2\n    gpu_validated: null', 'priority: 2\n    gpu_validated: 2026-10-21\n    low_vram_validated: 2026-10-25');
    expect(enabledExtensions(parseExtensionsConfig(effects, 'e.yaml'), 'validated', '12gb')).toEqual(['effects']);
    const transitions = replaceOnce(config, 'requires: [edit]\n    gpu_validated: 2026-10-22', 'requires: [edit]\n    gpu_validated: 2026-10-22\n    low_vram_validated: 2026-10-25');
    expect(enabledExtensions(parseExtensionsConfig(transitions, 'e.yaml'), 'validated', '12gb')).toEqual([]);
  });
  test('an explicit list is the same in every profile', () => {
    expect(enabledExtensions(parseExtensionsConfig(config, 'e.yaml'), 'music', '12gb')).toEqual(['music']);
  });
});
