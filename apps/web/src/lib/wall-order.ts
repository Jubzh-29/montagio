/**
 * The order of the Effects wall, in the Studio as in the showcase: Squish first, the most
 * adopted one-photo effect; anything not listed comes after, in its own order.
 */
export const EFFECT_ORDER = ['squish', 'explode', 'cakeify', 'snap-zoom', 'frozen-moment', 'full-circle'];
export const HOOK_ORDER = ['iris-dive', 'wardrobe-swap', 'figurine', 'ignite'];

export function wallOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}
