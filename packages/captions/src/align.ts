import { evenWords } from './demo';
import { CaptionsError, type CaptionWord } from './types';

/** A word as alignment compares it: no case, no accents, no punctuation ("Élan," → "elan"). */
export function normalizeToken(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 0 for the same word, less than 1 for a word that starts the same way ("Montagio" for "Shot"), 1 otherwise. */
function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return 1 - 0.5 * (prefix / Math.max(a.length, b.length, 1));
}

type Step = { kind: 'pair'; edited: number; heard: number } | { kind: 'added'; edited: number } | { kind: 'dropped'; heard: number };

/** The cheapest way to turn the heard words into the edited ones (Levenshtein), in order. */
function alignment(edited: string[], heard: string[]): Step[] {
  const n = edited.length;
  const m = heard.length;
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + substitutionCost(edited[i - 1]!, heard[j - 1]!), cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i]![j] === cost[i - 1]![j - 1]! + substitutionCost(edited[i - 1]!, heard[j - 1]!)) {
      steps.push({ kind: 'pair', edited: --i, heard: --j });
    } else if (i > 0 && (j === 0 || cost[i]![j] === cost[i - 1]![j]! + 1)) {
      steps.push({ kind: 'added', edited: --i });
    } else {
      steps.push({ kind: 'dropped', heard: --j });
    }
  }
  return steps.reverse();
}

/**
 * The corrected text on the moments Whisper heard: a fixed word keeps the moment of the word it
 * replaces, a word dropped next to a fixed one gives it its time ("Shot Rate" → "Montagio" spans both),
 * and added words share the time of the word before them (the word after them at the start).
 * Nothing heard: the text is spread over the clip.
 */
export function alignText(words: CaptionWord[], text: string, duration_s: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new CaptionsError('the text is empty');
  if (words.length === 0) return evenWords(text, duration_s);

  const steps = alignment(tokens.map(normalizeToken), words.map((word) => normalizeToken(word.text)));
  const spans: ({ start: number; end: number; fixed: boolean } | null)[] = tokens.map(() => null);
  steps.forEach((step) => {
    if (step.kind === 'pair') {
      const heard = words[step.heard]!;
      spans[step.edited] = { start: heard.start, end: heard.end, fixed: normalizeToken(tokens[step.edited]!) !== normalizeToken(heard.text) };
    }
  });

  // A dropped word next to a fixed one gives it its time; next to an unchanged word, it stays a pause.
  steps.forEach((step, index) => {
    if (step.kind !== 'dropped') return;
    const heard = words[step.heard]!;
    const before = steps.slice(0, index).reverse().find((other) => other.kind !== 'dropped');
    const after = steps.slice(index + 1).find((other) => other.kind !== 'dropped');
    const previous = before?.kind === 'pair' ? spans[before.edited] : null;
    const next = after?.kind === 'pair' ? spans[after.edited] : null;
    if (previous?.fixed) previous.end = Math.max(previous.end, heard.end);
    else if (next?.fixed) next.start = Math.min(next.start, heard.start);
  });

  // Added words: a run shares the span of the word before it, or of the word after it at the start.
  let index = 0;
  while (index < tokens.length) {
    if (spans[index]) {
      index++;
      continue;
    }
    let end = index;
    while (end < tokens.length && !spans[end]) end++;
    const run = end - index;
    const anchor = index > 0 ? index - 1 : end;
    const span = spans[anchor];
    if (!span) return evenWords(text, duration_s);
    const share = (span.end - span.start) / (run + 1);
    const parts = Array.from({ length: run + 1 }, (_, part) => ({ start: span.start + part * share, end: span.start + (part + 1) * share, fixed: span.fixed }));
    if (anchor < index) {
      spans[anchor] = parts[0]!;
      parts.slice(1).forEach((part, offset) => (spans[index + offset] = part));
    } else {
      parts.slice(0, run).forEach((part, offset) => (spans[index + offset] = part));
      spans[anchor] = parts[run]!;
    }
    index = end;
  }

  return tokens.map((token, n) => ({ text: token, start: spans[n]!.start, end: Math.min(spans[n]!.end, duration_s) }));
}
