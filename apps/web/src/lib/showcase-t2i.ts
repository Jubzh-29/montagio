import type { SampleSummary } from './api-types';

/**
 * The texts the showcase's Text to image offers: one per sample photo, the text it was made
 * from. None while a photo is a placeholder or has no text: the atelier then stays hidden
 * (spec §8), since "creating" a placeholder from a text would be a lie.
 */
export function showcaseTexts(samples: SampleSummary[]): { prompt: string; imageRef: SampleSummary['imageRef']; url: string }[] {
  if (samples.length === 0 || samples.some((sample) => sample.placeholder || !sample.prompt)) return [];
  return samples.map((sample) => ({ prompt: sample.prompt!, imageRef: sample.imageRef, url: sample.url }));
}
