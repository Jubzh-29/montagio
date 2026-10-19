import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLibrary, type Library } from '@montagio/presets';
import { checkWorkflow, type ObjectInfo } from '../lib/comfy';
import { EXTENSION_JOBS, extensionJobs } from '../lib/extension-jobs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const info = JSON.parse(readFileSync(new URL('./fixtures/object_info-v0.41.0.json', import.meta.url), 'utf8')) as ObjectInfo;

let library: Library;
beforeAll(async () => {
  library = await loadLibrary(repoRoot);
});

const base = { language: 'en' as const, duration_s: 10, seed: 7, aspect: '16:9' as const };

const files = { input: '/data/photo.png', input2: '/data/outfit.png', end: '/data/end.png', clip: '/data/clip.mp4', audio: '/data/speech.flac', audio_s: 6 };

test('one job per extension, in the order of the session, each accepted by ComfyUI v0.41.0 once its files are uploaded', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: [...EXTENSION_JOBS], effects: ['squish'], hook: 'outfit-morph' });
  expect(jobs.map((job) => [job.tag, job.model.id])).toEqual([
    ['edit', 'qwen-image-edit-2511'],
    ['effect:squish', 'wan21-i2v-effects'],
    ['hook-edit:outfit-morph', 'qwen-image-edit-2511'],
    ['transition:outfit-morph', 'wan22-flf2v-transition'],
    ['voice', 'chatterbox-mtl-voice'],
    ['avatar', 'wan22-s2v-avatar'],
    ['music', 'ace-step15-music'],
    ['upscale', 'seedvr2-upscale'],
  ]);
  for (const job of jobs) {
    const skip = job.files.map((file) => `${file.node}.${file.field}`);
    expect({ job: job.tag, problems: checkWorkflow(job.workflow, info, { skip }) }).toEqual({ job: job.tag, problems: [] });
  }
});

test('each job uploads the files it reads and nothing else', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: [...EXTENSION_JOBS], effects: ['squish'], hook: 'outfit-morph' });
  const uploads = Object.fromEntries(jobs.map((job) => [job.name, job.files]));
  expect(uploads.music).toEqual([]);
  expect(uploads.voice).toEqual([]);
  expect(uploads.upscale).toEqual([{ node: '73', field: 'file', path: '/data/clip.mp4' }]);
  expect(uploads.edit).toEqual([{ node: '41', field: 'image', path: '/data/photo.png' }]);
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

test('without a list, every effect of the pack runs, each with its own tag', () => {
  const jobs = extensionJobs(library, { ...base, jobs: ['effect'], input: '/p.png' });
  expect(jobs.map((job) => job.tag).sort()).toEqual(['effect:bullet-time', 'effect:cakeify', 'effect:crash-zoom-in', 'effect:explode', 'effect:orbit-360', 'effect:squish']);
});

test('the quality path drops the 4-step LoRAs of the edit, the effects and the transition', () => {
  const jobs = extensionJobs(library, { ...base, ...files, jobs: ['edit', 'effect', 'transition'], effects: ['squish'], hook: 'eyes-in', fast: false });
  expect(jobs.map((job) => job.params.fast)).toEqual([false, false, false]);
});

test('a job that needs a file not given is refused before anything runs', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['upscale'] })).toThrow(/--clip/);
  expect(() => extensionJobs(library, { ...base, jobs: ['avatar'], input: '/p.png' })).toThrow(/--audio/);
  expect(() => extensionJobs(library, { ...base, jobs: ['transition'], input: '/p.png', hook: 'eyes-in' })).toThrow(/--end/);
  expect(() => extensionJobs(library, { ...base, jobs: ['hook-edit'], input: '/p.png', hook: 'outfit-morph' })).toThrow(/second image/);
});

test('an unknown effect or hook is named, with the known ones', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['effect'], input: '/p.png', effects: ['karaoke'] })).toThrow(/unknown effect "karaoke".*squish/);
  expect(() => extensionJobs(library, { ...base, jobs: ['hook-edit'], input: '/p.png', hook: 'karaoke' })).toThrow(/unknown hook "karaoke".*eyes-in/);
});

test('the text goes to the job that reads one, with a default for each', () => {
  const [music, edit, voice] = extensionJobs(library, { ...base, jobs: ['music', 'edit', 'voice'], input: '/p.png', text: 'night rain' });
  expect(music!.params).toMatchObject({ prompt: 'night rain, instrumental', duration_s: 10 });
  expect(edit!.params).toMatchObject({ instruction: 'night rain' });
  expect(voice!.params).toMatchObject({ text: 'night rain' });
  const [defaults] = extensionJobs(library, { ...base, jobs: ['music'] });
  expect(defaults!.params).toMatchObject({ prompt: expect.stringContaining('instrumental') });
});
