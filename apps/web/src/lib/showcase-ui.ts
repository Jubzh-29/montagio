import type { MessageKey } from '@/i18n';
import type { ShowcaseInfo } from './api-types';

type Capabilities = ShowcaseInfo['capabilities'];

/**
 * What the Studio sends for rendering: everything outside the showcase; in it, what
 * the showcase router says it can do (GET /api/showcase), and nothing while it loads.
 * The static showcase can do neither; a live GPU backend would turn them on.
 */
export function studioCapabilities(showcase: boolean, info: Pick<ShowcaseInfo, 'capabilities'> | null): Capabilities {
  if (!showcase) return { uploads: true, remixRender: true };
  return info?.capabilities ?? { uploads: false, remixRender: false };
}

/**
 * The label of the Studio's main button. The showcase plays pre-generated clips,
 * so it shows a clip or assembles a film instead of generating; a remix gets a
 * button only where it can be rendered (the Studio explains why otherwise).
 */
export function primaryLabelKey(
  mode: 'single' | 'sequence',
  remix: boolean,
  { showcase, remixRender }: { showcase: boolean; remixRender: boolean },
): MessageKey | null {
  if (remix) return remixRender ? 'generateRemix' : null;
  if (showcase) return mode === 'single' ? 'showcaseShowClip' : 'showcaseAssembleFilm';
  return mode === 'single' ? 'generate' : 'generateFilm';
}

/**
 * The showcase's arrival clip. Effects first: the first sample photo with an effect example,
 * and the first effect rendered on it, so the Effects tab opens on a clip of its own. When
 * the URL asks for another tab, or no photo has an effect example, the first sample photo
 * (for the first camera preset).
 */
export function showcaseArrival<S extends { id: string }, E extends { id: string; samples?: string[] }>(
  samples: S[],
  effects: E[] | undefined,
  askedTab: string | null,
): { sample: S; effect?: E } | undefined {
  if (askedTab === null || askedTab === 'effects') {
    for (const sample of samples) {
      const effect = effects?.find((entry) => entry.samples?.includes(sample.id));
      if (effect) return { sample, effect };
    }
  }
  return samples[0] ? { sample: samples[0] } : undefined;
}

/** The showcase's note under the sample photos: one more sentence while some clips are placeholders. */
export function showcaseNoteKeys(placeholders: boolean): MessageKey[] {
  return placeholders ? ['showcaseNote', 'showcasePlaceholderNote'] : ['showcaseNote'];
}
