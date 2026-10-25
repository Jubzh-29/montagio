import { z } from 'zod';

/** What the Montagio Transcribe Words node writes: Whisper's pieces of words, each with its moment in the clip. */
export const WORDS_SCHEMA = 'montagio/words@1';

const seconds = z.number().finite().min(0);

export const WordsDocSchema = z
  .object({
    schema: z.literal(WORDS_SCHEMA),
    model: z.string().min(1).max(200),
    /** A Whisper language code, detected or imposed. */
    language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]+)?$/),
    detected: z.boolean(),
    duration_s: seconds,
    text: z.string().max(20_000),
    /** As Whisper cuts them: a piece that starts without a space continues the word before it. The last one may have no end. */
    chunks: z.array(z.object({ text: z.string().max(200), start: seconds, end: seconds.nullable() }).strict()).max(5_000),
  })
  .strict();

export type WordsDoc = z.infer<typeof WordsDocSchema>;

/** A word as the captions show it, with the moment it is said (seconds from the start of the clip). */
export type CaptionWord = { text: string; start: number; end: number };

/** The words of a clip in their order, in one language. */
export type CaptionTrack = { language: string; words: CaptionWord[] };

/** The corrected text of a captions export, in characters: the app refuses more. */
export const CAPTION_TEXT_MAX = 2000;

export class CaptionsError extends Error {
  override name = 'CaptionsError';
}
