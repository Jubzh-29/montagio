'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n';
import type { CanvasView } from '@/lib/studio-view';
import styles from './studio.module.css';

/**
 * The right-hand area: the wall of previews ("Gallery"), the monitor (the photo, the
 * render, the result, the recent creations under it), or the photo atelier over either.
 */
export function Canvas({
  view,
  onView,
  gallery,
  result,
  atelier,
  recent,
}: {
  view: CanvasView;
  onView: (view: CanvasView) => void;
  gallery: ReactNode;
  result: ReactNode;
  atelier?: ReactNode;
  recent?: ReactNode;
}) {
  const { t } = useI18n();
  // A tab without a wall (Avatar) shows the monitor: the photo, then the render.
  const shown = view === 'gallery' && !gallery ? 'result' : view;
  // The views of the canvas, as tabs (the pill is for options): the wall, the monitor, and the photo
  // atelier while one is open, so the atelier is never a dead end and the visitor can come back to it.
  const views: CanvasView[] = [...(gallery ? (['gallery'] as const) : []), 'result', ...(atelier ? (['atelier'] as const) : [])];
  const labels: Record<CanvasView, string> = { gallery: t('canvasGallery'), result: t('canvasResult'), atelier: t('canvasAtelier') };
  return (
    <section className={styles.stage} aria-label={t('monitor')}>
      {views.length > 1 && (
        <div className={styles.viewTabs} role="group" aria-label={t('canvasViews')}>
          {views.map((value) => (
            <button key={value} type="button" className={styles.viewTab} aria-pressed={shown === value} onClick={() => onView(value)}>
              {labels[value]}
            </button>
          ))}
        </div>
      )}
      {shown === 'gallery' && <div className={styles.canvasGallery}>{gallery}</div>}
      {/* Kept mounted out of view: a render in progress keeps its monitor, its focus and its live region. */}
      <div className={styles.canvasResult} hidden={shown !== 'result'}>
        {result}
        {recent}
      </div>
      {/* Kept mounted out of view too: a tab change or a render does not lose the atelier's text or its image. */}
      {atelier && <div hidden={view !== 'atelier'}>{atelier}</div>}
    </section>
  );
}
