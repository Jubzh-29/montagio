import { CaptionsError, parseWordsDoc, WORDS_SCHEMA, wordsFromChunks } from '../src';

const doc = {
  schema: 'montagio/words@1',
  model: 'whisper-large-v3-turbo',
  language: 'fr',
  detected: true,
  duration_s: 6,
  text: " Bienvenue. J'ai tourné",
  chunks: [
    { text: ' Bienvenue.', start: 0, end: 0.72 },
    { text: ' J', start: 2.94, end: 3.14 },
    { text: "'ai", start: 3.14, end: 3.16 },
    { text: ' tourné', start: 3.16, end: null },
  ],
};

describe('parseWordsDoc', () => {
  it('reads the document the node writes', () => {
    expect(WORDS_SCHEMA).toBe('montagio/words@1');
    expect(parseWordsDoc(structuredClone(doc))).toEqual(doc);
  });

  it('refuses another schema, a negative start and an unknown key', () => {
    const legacySchema = ['shot', 'rig/words@1'].join('');
    expect(() => parseWordsDoc({ ...doc, schema: legacySchema })).toThrow(CaptionsError);
    expect(() => parseWordsDoc({ ...doc, chunks: [{ text: ' a', start: -1, end: 1 }] })).toThrow(CaptionsError);
    expect(() => parseWordsDoc({ ...doc, extra: true })).toThrow(CaptionsError);
    expect(() => parseWordsDoc('not a document')).toThrow(CaptionsError);
  });
});

describe('wordsFromChunks', () => {
  it('joins a piece that does not start with a space to the word before it', () => {
    const words = wordsFromChunks(doc.chunks.slice(1, 3), 6);
    expect(words).toEqual([{ text: "J'ai", start: 2.94, end: 3.16 }]);
  });

  it('keeps the last word of a phrase from stretching over the silence after it', () => {
    const [word] = wordsFromChunks([{ text: ' Studio.', start: 1.06, end: 2.28 }], 6);
    // 6 letters: 1.06 + min(1.2, 0.25 + 0.12 × 6)
    expect(word!.end).toBeCloseTo(2.03, 5);
  });

  it('ends a last piece without an end at its bound, within the clip', () => {
    const words = wordsFromChunks(doc.chunks, 6);
    expect(words.at(-1)).toEqual({ text: 'tourné', start: 3.16, end: expect.closeTo(3.16 + 0.25 + 0.12 * 6, 5) });
    expect(wordsFromChunks([{ text: ' long', start: 5.9, end: null }], 6).at(-1)!.end).toBe(6);
  });

  it('drops empty pieces and keeps the times in order', () => {
    const words = wordsFromChunks(
      [
        { text: ' one', start: 0, end: 1 },
        { text: '   ', start: 1, end: 1.2 },
        { text: ' two', start: 0.8, end: 1.5 },
      ],
      3,
    );
    expect(words.map((word) => word.text)).toEqual(['one', 'two']);
    expect(words[1]!.start).toBeGreaterThanOrEqual(words[0]!.end);
    expect(words[1]!.end).toBeGreaterThan(words[1]!.start);
  });
});
