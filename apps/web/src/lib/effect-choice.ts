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
