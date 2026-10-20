import type { SampleSummary } from '@/lib/api-types';
import { showcaseTexts } from '@/lib/showcase-t2i';

const sample = (id: string, over: Partial<SampleSummary> = {}): SampleSummary => ({
  id,
  title: { en: id, fr: id },
  aspect: '16:9',
  imageRef: `samples/${id}`,
  url: `/showcase/samples/${id}.jpg`,
  placeholder: false,
  prompt: `the text of ${id}`,
  ...over,
});

test('Text to image stays hidden while a sample is a placeholder', () => {
  expect(showcaseTexts([sample('a'), sample('b', { placeholder: true })])).toEqual([]);
  expect(showcaseTexts([sample('a'), sample('b', { prompt: undefined })])).toEqual([]);
  expect(showcaseTexts([])).toEqual([]);
});

test('with final samples, picking a text selects its photo', () => {
  expect(showcaseTexts([sample('a'), sample('b')])).toEqual([
    { prompt: 'the text of a', imageRef: 'samples/a', url: '/showcase/samples/a.jpg' },
    { prompt: 'the text of b', imageRef: 'samples/b', url: '/showcase/samples/b.jpg' },
  ]);
});
