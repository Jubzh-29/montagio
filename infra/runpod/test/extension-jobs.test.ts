import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLibrary, type Library } from '@montagio/presets';
import { checkWorkflow, type ObjectInfo } from '../lib/comfy';
import { EXTENSION_JOBS, extensionJobs, jobTexts, photoFile, type ExtensionJobOptions } from '../lib/extension-jobs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const info = JSON.parse(readFileSync(new URL('./fixtures/object_info-v0.41.0.json', import.meta.url), 'utf8')) as ObjectInfo;

let library: Library;
beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

const base = { language: 'en' as const, duration_s: 10, seed: 7, aspect: '16:9' as const };

const files = { input: '/data/photo.png', input2: '/data/outfit.png', input3: '/data/product.png', end: '/data/end.png', clip: '/data/clip.mp4', clipAspect: '9:16' as const, clipFrames: 81, audio: '/data/speech.flac', audio_s: 6, voice: '/data/voice.flac', motion: '/data/motion.mp4', motion_s: 5, motionAspect: '9:16' as const, restyleFrame: '/data/first.png', restyleReference: { path: '/data/restyled.png', mode: 'first-frame' as const } };

test('one job per extension, in the order of the session, each accepted by ComfyUI v0.41.0 once its files are uploaded', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: [...EXTENSION_JOBS], effects: ['squish'], hook: 'wardrobe-swap' });
  expect(jobs.map((job) => [job.tag, job.model.id])).toEqual([
    ['edit', 'qwen-image-edit-2511'],
    ['compose:3refs', 'qwen-image-edit-2511'],
    ['effect:squish', 'wan21-i2v-effects'],
    ['hook-edit:wardrobe-swap', 'qwen-image-edit-2511'],
    ['transition:wardrobe-swap', 'wan22-flf2v-transition'],
    ['voice:cloned', 'chatterbox-mtl-voice'],
    ['avatar', 'wan22-s2v-avatar'],
    ['music', 'ace-step15-music'],
    ['upscale', 'seedvr2-upscale'],
    ['upscale-image', 'seedvr2-image-upscale'],
    ['voice-change', 'chatterbox-vc'],
    ['motion', 'wan-animate2-motion'],
    ['restyle-edit', 'qwen-image-edit-2511'],
    ['restyle:first-frame', 'wan21-vace-restyle'],
  ]);
  for (const job of jobs) {
    const skip = job.files.map((file) => `${file.node}.${file.field}`);
    expect({ job: job.tag, problems: checkWorkflow(job.workflow, info, { skip }) }).toEqual({ job: job.tag, problems: [] });
  }
});

test('each job uploads the files it reads and nothing else', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: [...EXTENSION_JOBS], effects: ['squish'], hook: 'wardrobe-swap' });
  const uploads = Object.fromEntries(jobs.map((job) => [job.name, job.files]));
  expect(uploads.music).toEqual([]);
  // with --voice, the voice speaks with the sample
  expect(uploads.voice).toEqual([{ node: '4', field: 'audio', path: '/data/voice.flac' }]);
  expect(uploads['voice-change']).toEqual([
    { node: '1', field: 'audio', path: '/data/speech.flac' },
    { node: '4', field: 'audio', path: '/data/voice.flac' },
  ]);
  expect(uploads.upscale).toEqual([{ node: '73', field: 'file', path: '/data/clip.mp4' }]);
  expect(uploads['upscale-image']).toEqual([{ node: '41', field: 'image', path: '/data/photo.png' }]);
  expect(uploads.motion).toEqual([
    { node: '189', field: 'image', path: '/data/photo.png' },
    { node: '240', field: 'file', path: '/data/motion.mp4' },
  ]);
  expect(uploads['restyle-edit']).toEqual([{ node: '41', field: 'image', path: '/data/first.png' }]);
  expect(uploads.restyle).toEqual([
    { node: '1', field: 'file', path: '/data/motion.mp4' },
    { node: '20', field: 'image', path: '/data/restyled.png' },
  ]);
  expect(uploads.edit).toEqual([{ node: '41', field: 'image', path: '/data/photo.png' }]);
  expect(uploads.compose).toEqual([
    { node: '41', field: 'image', path: '/data/photo.png' },
    { node: '42', field: 'image', path: '/data/outfit.png' },
    { node: '43', field: 'image', path: '/data/product.png' },
  ]);
  expect(uploads.effect).toEqual([{ node: '52', field: 'image', path: '/data/photo.png' }]);
  expect(uploads['hook-edit']).toEqual([
    { node: '41', field: 'image', path: '/data/photo.png' },
    { node: '42', field: 'image', path: '/data/outfit.png' },
  ]);
  expect(uploads.transition).toEqual([
    { node: '68', field: 'image', path: '/data/photo.png' },
    { node: '62', field: 'image', path: '/data/end.png' },
  ]);
  expect(uploads.avatar).toEqual([
    { node: '52', field: 'image', path: '/data/photo.png' },
    { node: '58', field: 'audio', path: '/data/speech.flac' },
  ]);
});

test('an extension record carries the sha256 of its photo', () => {
  // smoke.ts fingerprints the file each job binds to its model's image input: the showcase ingests only runs of its exact sample photo.
  const jobs = extensionJobs(library, { ...base, ...files, jobs: [...EXTENSION_JOBS], effects: ['squish'], hook: 'wardrobe-swap' });
  expect(Object.fromEntries(jobs.map((job) => [job.name, photoFile(job)]))).toEqual({
    edit: '/data/photo.png',
    compose: '/data/photo.png',
    effect: '/data/photo.png',
    'hook-edit': '/data/photo.png',
    transition: '/data/photo.png',
    voice: null,
    avatar: '/data/photo.png',
    music: null,
    upscale: null,
    'upscale-image': '/data/photo.png',
    'voice-change': null,
    motion: '/data/photo.png',
    'restyle-edit': '/data/first.png',
    restyle: '/data/restyled.png',
  });
});

test("a restyle follows its text alone, a look to follow, or the clip's first frame restyled by its edit", () => {
  const restyle = (extra: object) => extensionJobs(library, { ...base, motion: '/data/clip.mp4', motion_s: 5, motionAspect: '16:9', jobs: ['restyle'], ...extra })[0]!;
  const alone = restyle({});
  expect([alone.tag, alone.params.reference, alone.params.prompt]).toEqual(['restyle', null, 'a snowy winter evening']);
  expect(alone.files).toEqual([{ node: '1', field: 'file', path: '/data/clip.mp4' }]);
  const look = restyle({ restyleReference: { path: '/data/look.png', mode: 'look' }, text: { restyle: 'a watercolor painting' } });
  expect([look.tag, look.params.reference, look.params.prompt]).toEqual(['restyle:look', 'look', 'a watercolor painting']);
  expect(look.workflow['20']!.inputs.image).toBe('look.png');
  const [edit] = extensionJobs(library, { ...base, restyleFrame: '/data/first.png', jobs: ['restyle-edit'], text: { restyle: 'a watercolor painting' } });
  expect(edit!.params.instruction).toMatch(/^Change the look of this image: a watercolor painting\. Keep the framing/);
  expect(() => extensionJobs(library, { ...base, jobs: ['restyle'] })).toThrow(/--motion/);
});

test('without a list, every effect of the pack runs, each with its own tag', () => {
  const jobs = extensionJobs(library, { ...base, jobs: ['effect'], input: '/p.png' });
  expect(jobs.map((job) => job.tag).sort()).toEqual(['effect:cakeify', 'effect:explode', 'effect:frozen-moment', 'effect:full-circle', 'effect:snap-zoom', 'effect:squish']);
});

test('the edit job runs a look, so that a GPU session can validate each one', () => {
  const [edit] = extensionJobs(library, { ...base, jobs: ['edit'], input: '/p.png', look: 'infl8', text: { edit: 'inflate the person' } });
  expect(edit!.params).toMatchObject({ look: 'infl8', instruction: 'inflate the person' });
  expect(edit!.workflow['170']!.inputs.lora_name).toBe(library.lock.get('systms-infl8-qwen-edit-2511')!.file);
  expect(checkWorkflow(edit!.workflow, info, { skip: ['41.image'] })).toEqual([]);
});

test('an unknown look is named, with the known ones', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['edit'], input: '/p.png', look: 'karaoke' })).toThrow(/unknown look "karaoke".*infl8, action, angles/);
});

test('the quality path drops the 4-step LoRAs of the edit, the effects and the transition', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: ['edit', 'effect', 'transition'], effects: ['squish'], hook: 'iris-dive', fast: false });
  expect(jobs.map((job) => job.params.fast)).toEqual([false, false, false]);
});

test('the upscale job sizes the clip by its own aspect and frame count, not by the photo of the other jobs', () => {
  const clip = { clip: '/data/clip.mp4', clipAspect: '9:16' as const, clipFrames: 81 };
  const [upscale] = extensionJobs(library, { ...base, aspect: '16:9', input: '/data/photo.png', jobs: ['upscale'], ...clip });
  expect(upscale!.params).toMatchObject({ width: 1080, height: 1920 });
  expect(() => extensionJobs(library, { ...base, jobs: ['upscale'], ...clip, clipFrames: 122 })).toThrow(/a clip of 122 frames is longer than the 121 frames/);
});

test('--smooth keeps the RIFE nodes of the upscale job; without it they are removed', () => {
  const clip = { clip: '/data/clip.mp4', clipAspect: '16:9' as const, clipFrames: 81 };
  const [plain] = extensionJobs(library, { ...base, jobs: ['upscale'], ...clip });
  const [smooth] = extensionJobs(library, { ...base, jobs: ['upscale'], ...clip, smooth: true });
  expect(plain!.params.smooth).toBe(false);
  expect(plain!.workflow['102']).toBeUndefined();
  expect(smooth!.params.smooth).toBe(true);
  expect(smooth!.workflow['102']?.class_type).toBe('FrameInterpolate');
  expect(smooth!.files).toEqual(plain!.files);
});

test('a job that needs a file not given is refused before anything runs', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['upscale'] })).toThrow(/--clip/);
  expect(() => extensionJobs(library, { ...base, jobs: ['upscale'], clip: '/c.mp4' })).toThrow(/the upscale job needs the aspect and the frame count of its clip/);
  expect(() => extensionJobs(library, { ...base, jobs: ['avatar'], input: '/p.png' })).toThrow(/--audio/);
  expect(() => extensionJobs(library, { ...base, jobs: ['transition'], input: '/p.png', hook: 'iris-dive' })).toThrow(/--end/);
  expect(() => extensionJobs(library, { ...base, jobs: ['hook-edit'], input: '/p.png', hook: 'wardrobe-swap' })).toThrow(/second image/);
});

test('an unknown effect or hook is named, with the known ones', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['effect'], input: '/p.png', effects: ['karaoke'] })).toThrow(/unknown effect "karaoke".*squish/);
  expect(() => extensionJobs(library, { ...base, jobs: ['hook-edit'], input: '/p.png', hook: 'karaoke' })).toThrow(/unknown hook "karaoke".*iris-dive/);
});

test('each text reaches the job it is given for, the other jobs keep their default', () => {
  const run = (text: ExtensionJobOptions['text']) =>
    Object.fromEntries(extensionJobs(library, { ...base, jobs: ['edit', 'effect', 'voice', 'music'], input: '/p.png', effects: ['squish'], text }).map((job) => [job.name, job.params]));
  const defaults = run(undefined);
  const edited = run({ edit: 'make it a snowy night' });
  expect(edited.edit).toMatchObject({ instruction: 'make it a snowy night' });
  expect({ effect: edited.effect, voice: edited.voice, music: edited.music }).toEqual({ effect: defaults.effect, voice: defaults.voice, music: defaults.music });
  const all = run({ edit: 'night rain', effect: 'red toy car', voice: 'Bonjour', music: 'calm piano' });
  expect(all.edit).toMatchObject({ instruction: 'night rain' });
  expect(all.effect!.prompt).toContain('red toy car');
  expect(all.voice).toMatchObject({ text: 'Bonjour' });
  expect(all.music).toMatchObject({ prompt: 'calm piano, instrumental', duration_s: 10 });
  expect(defaults.music).toMatchObject({ prompt: expect.stringContaining('instrumental') });
});

describe('jobTexts (smoke --text)', () => {
  test('a bare text goes to the one job of the run that reads a text, = and all', () => {
    // the avatar reads no text: the voice it speaks does
    expect(jobTexts(['Bonjour, ceci est un essai.'], ['voice', 'avatar'])).toEqual({ voice: 'Bonjour, ceci est un essai.' });
    expect(jobTexts(['style=noir'], ['edit', 'upscale'])).toEqual({ edit: 'style=noir' });
    expect(jobTexts([], [...EXTENSION_JOBS])).toEqual({});
  });

  test('when several jobs read a text, a bare one is refused and each text names its job', () => {
    expect(() => jobTexts(['night rain'], [...EXTENSION_JOBS])).toThrow(/edit, effect, voice, music, motion, restyle read a text: name the job, as in --text edit=/);
    expect(jobTexts(['music=calm piano', 'edit=make it snow'], [...EXTENSION_JOBS])).toEqual({ music: 'calm piano', edit: 'make it snow' });
  });

  test('a text for a job the run does not have, a job given two texts, or a run with no text job are refused', () => {
    expect(() => jobTexts(['music=calm piano'], ['edit'])).toThrow(/--text music=…: the music job is not part of this run/);
    expect(() => jobTexts(['edit=snow', 'edit=rain'], ['edit'])).toThrow(/two texts for the edit job/);
    expect(() => jobTexts(['snow'], ['upscale', 'transition'])).toThrow(/no job of this run reads a text/);
  });
});
