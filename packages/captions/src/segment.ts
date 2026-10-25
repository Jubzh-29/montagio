import type { CaptionWord } from './types';

/** A line of captions: the words shown together, from the first word's start to `end`. */
export type CaptionLine = { words: CaptionWord[]; start: number; end: number };

/** How a style cuts the words into lines (after RushGlide's splitSegmentsByWordCount and resplitSegments). */
export type LineRules = { maxWords: number; maxChars: number; pause_s: number; hold_s: number };

const STRONG_STOP = /[.!?…]["»”’)]*$/;
const WEAK_STOP = /[,;:]["»”’)]*$/;

/**
 * The lines a style shows: a line ends after a full stop, a question or an exclamation mark, after a
 * comma once it has three words, before a pause longer than `pause_s`, and before it would pass
 * `maxWords` words or `maxChars` characters (a single longer word stays alone on its line). A line
 * stays `hold_s` after its last word, until the next one starts at most.
 */
export function segmentWords(words: CaptionWord[], rules: LineRules): CaptionLine[] {
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  const close = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const word of words) {
    const previous = current.at(-1);
    if (previous) {
      const chars = [...current, word].map((item) => item.text).join(' ').length;
      if (word.start - previous.end > rules.pause_s || current.length >= rules.maxWords || chars > rules.maxChars) close();
    }
    current.push(word);
    if (STRONG_STOP.test(word.text) || (WEAK_STOP.test(word.text) && current.length >= 3)) close();
  }
  close();
  return groups.map((group, index) => {
    const last = group.at(-1)!;
    const next = groups[index + 1]?.[0];
    const held = last.end + rules.hold_s;
    return { words: group, start: group[0]!.start, end: next ? Math.max(last.end, Math.min(held, next.start)) : held };
  });
}
