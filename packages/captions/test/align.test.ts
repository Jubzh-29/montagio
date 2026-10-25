import { alignText, CaptionsError, normalizeToken, type CaptionWord } from '../src';

// What Whisper heard on demo-assets/examples/avatar.mp4 (the CPU spike of 25/10).
const heard: CaptionWord[] = [
  ['Hello,', 0, 0.68],
  ['this', 0.68, 0.86],
  ['is', 0.86, 1.02],
  ['a', 1.02, 1.12],
  ['test', 1.12, 1.34],
  ['of', 1.34, 1.5],
  ['the', 1.5, 1.64],
  ['Shot', 1.64, 1.84],
  ['Rate', 1.84, 2.04],
  ['Avatar.', 2.04, 2.86],
].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));

function expectOrdered(words: CaptionWord[], duration_s: number) {
  let floor = 0;
  for (const word of words) {
    expect(word.start).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(word.end).toBeGreaterThan(word.start);
    expect(word.end).toBeLessThanOrEqual(duration_s + 1e-9);
    floor = word.end;
  }
}

describe('normalizeToken', () => {
  it('compares words without case, accents or punctuation', () => {
    expect(normalizeToken('Élan,')).toBe('elan');
    expect(normalizeToken("J'ai")).toBe('jai');
    expect(normalizeToken('«Bonjour»')).toBe('bonjour');
  });
});

describe('alignText', () => {
  it('keeps the times of a text that was not changed', () => {
    expect(alignText(heard, heard.map((word) => word.text).join(' '), 2.94)).toEqual(heard);
  });

  it('gives a fixed word the time of the words it replaces', () => {
    const words = alignText(heard, 'Hello, this is a test of the Montagio avatar.', 2.94);
    expect(words.map((word) => word.text)).toEqual(['Hello,', 'this', 'is', 'a', 'test', 'of', 'the', 'Montagio', 'avatar.']);
    expect(words[7]).toEqual({ text: 'Montagio', start: 1.64, end: 2.04 });
    expect(words[8]).toEqual({ text: 'avatar.', start: 2.04, end: 2.86 });
  });

  it('lets an added word share the time of its neighbour', () => {
    const words = alignText(heard, 'Well, hello, this is a test of the Montagio avatar.', 2.94);
    expect(words[0]!.text).toBe('Well,');
    expect(words[0]!.end).toBeLessThanOrEqual(words[1]!.start + 1e-9);
    expectOrdered(words, 2.94);
    const tail = alignText(heard, 'Hello, this is a test of the Montagio avatar. Thanks', 2.94);
    expect(tail.at(-1)!.text).toBe('Thanks');
    expectOrdered(tail, 2.94);
  });

  it('spreads a text that shares nothing with what was heard over the same span', () => {
    const words = alignText(heard, 'Bonjour tout le monde', 2.94);
    expect(words).toHaveLength(4);
    expectOrdered(words, 2.94);
    expect(words[0]!.start).toBeCloseTo(0, 5);
    expect(words.at(-1)!.end).toBeLessThanOrEqual(2.86 + 1e-9);
  });

  it('spreads the text over the clip when nothing was heard', () => {
    const words = alignText([], 'one two three', 3);
    expect(words).toHaveLength(3);
    expectOrdered(words, 3);
  });

  it('refuses an empty text', () => {
    expect(() => alignText(heard, '   \n ', 2.94)).toThrow(CaptionsError);
  });
});
