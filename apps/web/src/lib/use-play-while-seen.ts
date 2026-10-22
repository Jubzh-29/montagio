'use client';

import { useEffect, type RefObject } from 'react';

/**
 * A looping preview plays only while a quarter of it is on screen, and never while the previews are
 * paused (the toggle, or reduced motion): a wall of a dozen clips no longer runs them all at once,
 * which costs the visitor's battery and draws the eye away from what they look at.
 */
export function usePlayWhileSeen(video: RefObject<HTMLVideoElement | null>, paused: boolean, src?: string): void {
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) {
      element.pause();
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      element.play().catch(() => undefined);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) element.play().catch(() => undefined);
        else element.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [video, paused, src]);
}
