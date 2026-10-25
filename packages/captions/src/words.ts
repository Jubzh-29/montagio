import { CaptionsError, WORDS_SCHEMA, WordsDocSchema, type CaptionWord, type WordsDoc } from './types';

/** Read what the node wrote; anything else is refused. */
export function parseWordsDoc(value: unknown): WordsDoc {
  const parsed = WordsDocSchema.safeParse(value);
  if (!parsed.success) throw new CaptionsError(`not a ${WORDS_SCHEMA} document: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data;
}

/** Letters and digits of a word, the measure of how long it may last. */
const letters = (word: string) => (word.match(/[\p{L}\p{N}]/gu) ?? []).length;

/**
 * The longest a word may last: Whisper often stretches the last word of a phrase over the silence
 * after it, and a karaoke sweep would then crawl across that silence.
 */
export const longestWord = (word: string) => Math.min(1.2, 0.25 + 0.12 * letters(word));

/**
 * The words of Whisper's pieces: a piece that does not start with a space joins the word before it
 * ("J" + "'ai"), empty pieces go, each word ends at its bound at most, and the times only go forward.
 */
export function wordsFromChunks(chunks: WordsDoc['chunks'], duration_s: number): CaptionWord[] {
  const joined: { text: string; start: number; end: number | null }[] = [];
  for (const chunk of chunks) {
    if (!chunk.text.trim()) continue;
    const previous = joined.at(-1);
    if (previous && !/^\s/.test(chunk.text)) {
      previous.text += chunk.text.trim();
      previous.end = chunk.end;
    } else {
      joined.push({ text: chunk.text.trim(), start: chunk.start, end: chunk.end });
    }
  }
  const words: CaptionWord[] = [];
  let floor = 0;
  for (const word of joined) {
    const start = Math.min(Math.max(word.start, floor), duration_s);
    const bound = Math.min(duration_s, start + longestWord(word.text));
    const end = Math.max(Math.min(word.end ?? bound, bound), Math.min(start + 0.01, duration_s));
    words.push({ text: word.text, start, end });
    floor = end;
  }
  return words;
}
