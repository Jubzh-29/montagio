import type { ExtensionsInfo } from './api-types';

/** The Studio's creation tabs, in the header's order. */
export type Tab = 'effects' | 'camera' | 'film' | 'avatar' | 'motion';
export const TAB_ORDER: readonly Tab[] = ['effects', 'camera', 'film', 'avatar', 'motion'];

/**
 * The tabs whose screen exists in this build: a tab the extensions allow but whose screen
 * is not built yet stays hidden, so a lot cut short shows nothing half-wired.
 */
export const READY_TABS: ReadonlySet<Tab> = new Set<Tab>(['effects', 'camera', 'film', 'avatar', 'motion']);

/** Hooks join the Effects wall once their two-step render (edit, then transition) is wired. */
export const HOOKS_READY = true;

/**
 * The tabs the Studio shows: Effects as soon as one effect or hook is shown (the viral
 * format opens the Studio), Camera and Film always, Avatar with its extension, and Motion with the
 * motion transfer or the restyle (the two uses of its clip).
 */
export function visibleTabs(info: ExtensionsInfo | null, ready: ReadonlySet<Tab> = READY_TABS, hooksReady = HOOKS_READY): Tab[] {
  const shown = new Set<Tab>(['camera', 'film']);
  if (info && info.effects.length + (hooksReady ? info.hooks.length : 0) > 0) shown.add('effects');
  if (info?.extensions.includes('avatar')) shown.add('avatar');
  if (info?.extensions.includes('motion') || info?.extensions.includes('restyle')) shown.add('motion');
  return TAB_ORDER.filter((tab) => shown.has(tab) && ready.has(tab));
}

/** The tab a URL asks for, if it is shown; otherwise the first shown one. */
export function pickTab(requested: string | null, visible: Tab[]): Tab {
  return visible.find((tab) => tab === requested) ?? visible[0] ?? 'camera';
}

export function tabHref(tab: Tab): string {
  return `/?tab=${tab}`;
}
