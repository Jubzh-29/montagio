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

test('one job per extension, each accepted by ComfyUI v0.41.0 once its files are uploaded', () => {
  const jobs = extensionJobs(library, {
    ...base,
    jobs: [...EXTENSION_JOBS],
    input: '/data/photo.png',
    clip: '/data/clip.mp4',
    audio: '/data/speech.flac',
    audio_s: 6,
  });
  expect(jobs.map((job) => [job.name, job.model.id])).toEqual([
    ['music', 'ace-step15-music'],
    ['upscale', 'seedvr2-upscale'],
    ['edit', 'qwen-image-edit-2511'],
    ['voice', 'chatterbox-mtl-voice'],
    ['avatar', 'wan22-s2v-avatar'],
  ]);
  for (const job of jobs) {
    const skip = job.files.map((file) => `${file.node}.${file.field}`);
    expect({ job: job.name, problems: checkWorkflow(job.workflow, info, { skip }) }).toEqual({ job: job.name, problems: [] });
  }
});

test('each job uploads the files it reads and nothing else', () => {
  const jobs = extensionJobs(library, { ...base, jobs: [...EXTENSION_JOBS], input: '/p.png', clip: '/c.mp4', audio: '/s.flac', audio_s: 6 });
  const files = Object.fromEntries(jobs.map((job) => [job.name, job.files]));
  expect(files.music).toEqual([]);
  expect(files.voice).toEqual([]);
  expect(files.upscale).toEqual([{ node: '73', field: 'file', path: '/c.mp4' }]);
  expect(files.edit).toEqual([{ node: '41', field: 'image', path: '/p.png' }]);
  expect(files.avatar).toEqual([
    { node: '52', field: 'image', path: '/p.png' },
    { node: '58', field: 'audio', path: '/s.flac' },
  ]);
});

test('a job that needs a file not given is refused before anything runs', () => {
  expect(() => extensionJobs(library, { ...base, jobs: ['upscale'] })).toThrow(/--clip/);
  expect(() => extensionJobs(library, { ...base, jobs: ['avatar'], input: '/p.png' })).toThrow(/--audio/);
});

test('the text goes to the job that reads one, with a default for each', () => {
  const [music, edit, voice] = extensionJobs(library, { ...base, jobs: ['music', 'edit', 'voice'], input: '/p.png', text: 'night rain' });
  expect(music!.params).toMatchObject({ prompt: 'night rain, instrumental', duration_s: 10 });
  expect(edit!.params).toMatchObject({ instruction: 'night rain' });
  expect(voice!.params).toMatchObject({ text: 'night rain' });
  const [defaults] = extensionJobs(library, { ...base, jobs: ['music'] });
  expect(defaults!.params).toMatchObject({ prompt: expect.stringContaining('instrumental') });
});
