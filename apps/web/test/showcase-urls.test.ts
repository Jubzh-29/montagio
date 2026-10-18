import { filmTags, concatArgs } from '@/showcase/montage-args';
import { urlsFor } from '@/showcase/urls';
import { AI_METADATA, PLACEHOLDER_METADATA } from '@montagio/sequence/tags';

test('prefixes showcase and ffmpeg URLs with the base path', () => {
  expect(urlsFor('').showcaseUrl('clips/a.mp4')).toBe('/showcase/clips/a.mp4');
  expect(urlsFor('').ffmpegUrl('esm/worker.js')).toBe('/ffmpeg/esm/worker.js');
  expect(urlsFor('/montagio').showcaseUrl('data.json')).toBe('/montagio/showcase/data.json');
  expect(urlsFor('/montagio').ffmpegUrl('ffmpeg-core.wasm')).toBe('/montagio/ffmpeg/ffmpeg-core.wasm');
});

test('a film is AI-generated only when no shot is a placeholder', () => {
  expect(filmTags(false)).toEqual(AI_METADATA);
  expect(filmTags(true)).toEqual(PLACEHOLDER_METADATA);
});

test('the montage joins with the concat demuxer, without re-encoding, and writes the tags', () => {
  expect(concatArgs('list.txt', 'film.mp4', AI_METADATA)).toEqual([
    '-f', 'concat', '-safe', '0', '-i', 'list.txt',
    '-c', 'copy',
    '-map_metadata', '-1',
    '-metadata', 'comment=AI-generated',
    '-metadata', `description=${AI_METADATA.description}`,
    '-movflags', '+faststart',
    'film.mp4',
  ]);
});
