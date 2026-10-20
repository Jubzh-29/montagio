/**
 * What the photo shows, for an effect's prompt: the text a photo was made from, cut on a
 * word to the model's limit; nothing for a photo that was not made from a text.
 */
export function defaultSubject(photoPrompt: string | undefined, max: number): string {
  const text = (photoPrompt ?? '').trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}

export type WallFilter = 'all' | 'effects' | 'hooks';

/** The wall's tiles: the effects, then the hooks, each tagged with its kind. */
export function wallFilter<E extends { id: string }, H extends { id: string }>(
  effects: E[],
  hooks: H[],
  filter: WallFilter,
): ({ kind: 'effect'; id: string; item: E } | { kind: 'hook'; id: string; item: H })[] {
  return [
    ...(filter === 'hooks' ? [] : effects.map((item) => ({ kind: 'effect' as const, id: item.id, item }))),
    ...(filter === 'effects' ? [] : hooks.map((item) => ({ kind: 'hook' as const, id: item.id, item }))),
  ];
}

export type WallChoice<E, H> = { kind: 'effect'; item: E } | { kind: 'hook'; item: H };

/** The tile chosen on the Effects wall: the one picked while it is shown, else the first effect, else the first hook. */
export function pickWallChoice<E extends { id: string }, H extends { id: string }>(
  effects: E[],
  hooks: H[],
  pickedId: string | null,
): WallChoice<E, H> | undefined {
  const effect = effects.find((entry) => entry.id === pickedId);
  if (effect) return { kind: 'effect', item: effect };
  const hook = hooks.find((entry) => entry.id === pickedId);
  if (hook) return { kind: 'hook', item: hook };
  if (effects[0]) return { kind: 'effect', item: effects[0] };
  return hooks[0] ? { kind: 'hook', item: hooks[0] } : undefined;
}

/** In the showcase, what the wall offers on a sample photo: the effects and hooks with an example for it (all of them before a photo is picked). */
export function forSample<T extends { samples?: string[] }>(items: T[], sampleId: string | null): T[] {
  return sampleId === null ? items : items.filter((item) => !item.samples || item.samples.includes(sampleId));
}
