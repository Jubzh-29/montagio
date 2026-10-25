import type { CaptionWord } from './types';

/**
 * A text spread over `duration_s`, each word in proportion to its letters (one at least): the demo's
 * timings, and the fallback when nothing was heard. Not what anyone said when: the demo says so.
 */
export function evenWords(text: string, duration_s: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((token) => Math.max(1, (token.match(/[\p{L}\p{N}]/gu) ?? []).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = 0;
  return tokens.map((token, index) => {
    const start = at;
    at += (duration_s * weights[index]!) / total;
    return { text: token, start, end: index === tokens.length - 1 ? duration_s : at };
  });
}
