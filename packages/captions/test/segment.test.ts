import { CAPTION_LANGUAGES, evenWords, isCaptionLanguage, segmentWords, type CaptionWord } from '../src';

const rules = { maxWords: 4, maxChars: 20, pause_s: 0.5, hold_s: 0.3 };
const at = (text: string, start: number, end: number): CaptionWord => ({ text, start, end });
const texts = (lines: ReturnType<typeof segmentWords>) => lines.map((line) => line.words.map((word) => word.text).join(' '));

describe('segmentWords', () => {
  it('breaks after a full stop, a question or an exclamation mark', () => {
    const lines = segmentWords([at('Hi.', 0, 0.3), at('Who', 0.3, 0.5), at('is', 0.5, 0.6), at('it?', 0.6, 0.9), at('Me!', 0.9, 1.2)], rules);
    expect(texts(lines)).toEqual(['Hi.', 'Who is it?', 'Me!']);
  });

  it('breaks after a comma once the line has three words', () => {
    const lines = segmentWords([at('Yes,', 0, 0.2), at('we', 0.2, 0.4), at('can,', 0.4, 0.6), at('now', 0.6, 0.8), at('go,', 0.8, 1), at('ok', 1, 1.2)], {
      ...rules,
      maxWords: 6,
      maxChars: 40,
    });
    expect(texts(lines)).toEqual(['Yes, we can,', 'now go, ok']);
  });

  it('breaks on a pause longer than pause_s', () => {
    const lines = segmentWords([at('one', 0, 0.3), at('two', 0.3, 0.6), at('three', 1.3, 1.6)], rules);
    expect(texts(lines)).toEqual(['one two', 'three']);
  });

  it('never puts more than maxWords or maxChars on a line, except a single long word', () => {
    const words = 'a bb ccc dddd eeeee ffffff ggggggg extraordinarily-long-word h'.split(' ').map((text, index) => at(text, index * 0.2, index * 0.2 + 0.2));
    const lines = segmentWords(words, rules);
    for (const line of lines) {
      expect(line.words.length).toBeLessThanOrEqual(4);
      const chars = line.words.map((word) => word.text).join(' ').length;
      if (line.words.length > 1) expect(chars).toBeLessThanOrEqual(20);
    }
    expect(texts(lines)).toContain('extraordinarily-long-word');
  });

  it('holds a line after its last word, until the next line starts at most', () => {
    const lines = segmentWords([at('One.', 0, 0.5), at('Two.', 0.6, 1), at('Three.', 3, 3.4)], rules);
    expect(lines[0]).toMatchObject({ start: 0, end: 0.6 });
    expect(lines[1]!.end).toBeCloseTo(1.3, 5);
    expect(lines[2]!.end).toBeCloseTo(3.7, 5);
  });

  it('gives nothing for no words', () => {
    expect(segmentWords([], rules)).toEqual([]);
  });
});

describe('languages', () => {
  it('lists the 22 languages written in the Latin alphabet that the fonts cover', () => {
    expect(CAPTION_LANGUAGES).toHaveLength(22);
    expect(isCaptionLanguage('fr')).toBe(true);
    expect(isCaptionLanguage('ja')).toBe(false);
    expect(isCaptionLanguage('vi')).toBe(false);
  });
});

describe('evenWords', () => {
  it('spreads a text in proportion to the letters of each word, over the whole span', () => {
    const words = evenWords('a bbb', 4);
    expect(words).toEqual([
      { text: 'a', start: 0, end: 1 },
      { text: 'bbb', start: 1, end: 4 },
    ]);
  });
});
