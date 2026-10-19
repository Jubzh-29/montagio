import { readFileSync } from 'node:fs';
import { enabledExtensions, parseExtensionModel, parseExtensionsConfig, parseLock, RegistryError } from '../src/index';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const music = read('ext-music.yaml');
const config = read('extensions.yaml');
const replaceOnce = (text: string, from: string | RegExp, to: string) => {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`fixture does not contain ${String(from)}`);
  return out;
};

test('parses the ACE-Step music model with a binding on two fields', () => {
  const m = parseExtensionModel(music, 'ext-music.yaml');
  expect(m).toMatchObject({ id: 'ace-step15-music', extension: 'music', task: 't2a', output: { node: '107', kind: 'audio' } });
  expect(m.bindings.duration_s).toEqual([
    { node: '98', field: 'seconds' },
    { node: '94', field: 'duration' },
  ]);
  expect(m.bindings.prompt).toEqual({ node: '94', field: 'tags' });
  expect(m.limits).toEqual({ min_duration_s: 10, max_duration_s: 60, max_chars: 300 });
});

test('a missing required binding is named', () => {
  expect(() => parseExtensionModel(replaceOnce(music, /  bpm: .*\n/, ''), 'm.yaml')).toThrow(/binding "bpm" is required by task "t2a"/);
});

test('an output kind that does not match the task is refused', () => {
  expect(() => parseExtensionModel(replaceOnce(music, 'kind: audio', 'kind: image'), 'm.yaml')).toThrow(/output\.kind.*t2a.*audio/);
});

test('a non-permissive license is refused', () => {
  expect(() => parseExtensionModel(replaceOnce(music, 'license: MIT', 'license: CC-BY-NC-4.0'), 'm.yaml')).toThrow(RegistryError);
});

test('an empty binding list is refused', () => {
  expect(() => parseExtensionModel(replaceOnce(music, /duration_s: \[.*\]/, 'duration_s: []'), 'm.yaml')).toThrow(/duration_s/);
});

test('an unknown limit is refused', () => {
  expect(() => parseExtensionModel(replaceOnce(music, 'max_chars: 300', 'max_chars: 300, fps: 16'), 'm.yaml')).toThrow(/limits/);
});

test('the config needs each of the 4 extensions exactly once', () => {
  const parsed = parseExtensionsConfig(config, 'extensions.yaml');
  expect(parsed.map((e) => e.id)).toEqual(['music', 'upscale', 'edit', 'avatar']);
  expect(() => parseExtensionsConfig(replaceOnce(config, '- id: upscale', '- id: music'), 'e.yaml')).toThrow(/music.*once|upscale/);
  const withoutAvatar = config.slice(0, config.indexOf('  - id: avatar'));
  expect(() => parseExtensionsConfig(withoutAvatar, 'e.yaml')).toThrow(/avatar/);
});

test('two extensions cannot share a priority', () => {
  expect(() => parseExtensionsConfig(replaceOnce(config, 'priority: 2', 'priority: 1'), 'e.yaml')).toThrow(/priority/);
});

test('gpu_validated is a date or null', () => {
  expect(parseExtensionsConfig(config, 'e.yaml').map((e) => e.gpu_validated)).toEqual(['2026-10-22', null, '2026-10-22', null]);
  expect(() => parseExtensionsConfig(replaceOnce(config, 'gpu_validated: 2026-10-22', 'gpu_validated: yes'), 'e.yaml')).toThrow(/gpu_validated/);
});

describe('enabledExtensions', () => {
  const parsed = parseExtensionsConfig(config, 'extensions.yaml');
  test.each([undefined, '', 'validated'])('%j shows the extensions validated on GPU, by priority', (flag) => {
    expect(enabledExtensions(parsed, flag)).toEqual(['music', 'edit']);
  });
  test('all and none', () => {
    expect(enabledExtensions(parsed, 'all')).toEqual(['music', 'upscale', 'edit', 'avatar']);
    expect(enabledExtensions(parsed, 'none')).toEqual([]);
  });
  test('a list, in priority order whatever its own order', () => {
    expect(enabledExtensions(parsed, 'edit, music')).toEqual(['music', 'edit']);
    expect(enabledExtensions(parsed, 'avatar')).toEqual(['avatar']);
  });
  test('an unknown extension in the list is named', () => {
    expect(() => enabledExtensions(parsed, 'music,karaoke')).toThrow(/karaoke/);
  });
});

const lock = `schema: montagio/lock@0.1
weights:
  - id: ace-step15-vae
    file: ace_1.5_vae.safetensors
    url: https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/vae/ace_1.5_vae.safetensors
    license: MIT
    source: https://huggingface.co/ACE-Step/Ace-Step1.5
`;

test('a lock entry may name its extension', () => {
  expect(parseLock(`${lock}    extension: music\n`, 'l.yaml')[0]?.extension).toBe('music');
  expect(parseLock(lock, 'l.yaml')[0]?.extension).toBeUndefined();
});

test('an unknown extension in the lock is refused', () => {
  expect(() => parseLock(`${lock}    extension: karaoke\n`, 'l.yaml')).toThrow(/extension/);
});

test('a lock entry may give a nested models/ folder', () => {
  expect(parseLock(`${lock}    folder: tts/chatterbox/resembleai-mtl-v3\n`, 'l.yaml')[0]?.folder).toBe('tts/chatterbox/resembleai-mtl-v3');
});

test.each(['../outside', '/absolute', 'tts/../../x', 'tts/./x', 'tts\\x'])('the folder %s is refused', (folder) => {
  expect(() => parseLock(`${lock}    folder: "${folder}"\n`, 'l.yaml')).toThrow(/folder/);
});
