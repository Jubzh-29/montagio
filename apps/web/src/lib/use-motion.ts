'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the looping previews (move glyphs, the monitor's viewfinder, preview
 * clips) are paused. They loop forever, so a visitor must be able to stop them
 * (WCAG 2.2.2); they start paused when the system asks for reduced motion. A
 * choice made with the toggle wins and is remembered in this browser.
 */
const STORAGE_KEY = 'motion';
const REDUCE = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();
/** The toggle's choice when storage is unavailable (private mode): it lasts for this page. */
let chosen: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia(REDUCE);
  media.addEventListener('change', listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', listener);
    window.removeEventListener('storage', listener);
  };
}

function readPaused(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'paused') return true;
    if (stored === 'playing') return false;
  } catch {
    // storage unavailable: the choice made on this page, else the system setting
  }
  return chosen ?? window.matchMedia(REDUCE).matches;
}

export function useMotionPaused(): [paused: boolean, setPaused: (paused: boolean) => void] {
  // The server renders the previews running; a reduced-motion browser pauses them on hydration.
  const paused = useSyncExternalStore(subscribe, readPaused, () => false);
  const setPaused = useCallback((next: boolean) => {
    chosen = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'paused' : 'playing');
    } catch {
      // storage unavailable: `chosen` keeps the choice for this page
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [paused, setPaused];
}
