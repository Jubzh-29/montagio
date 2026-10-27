/**
 * Bring what a click just made into view, when it lands outside it (a portrait under a long form, a result in the other
 * column): to its nearest edge, past the sticky header (the page's scroll padding), smoothly unless motion is reduced.
 */
export function reveal(element: Element | null | undefined): void {
  if (!element) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}
