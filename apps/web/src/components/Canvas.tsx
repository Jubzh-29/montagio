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
  onView: (view: 'gallery' | 'result') => void;
  gallery: ReactNode;
  result: ReactNode;
  atelier?: ReactNode;
  recent?: ReactNode;
}) {
  const { t } = useI18n();
  // A tab without a wall (Avatar) shows the monitor: the photo, then the render.
  const shown = view === 'gallery' && !gallery ? 'result' : view;
  return (
    <section className={styles.stage} aria-label={t('monitor')}>
      {view !== 'atelier' && gallery && (
        <div className={styles.canvasViews} role="group" aria-label={t('canvasViews')}>
          {(['gallery', 'result'] as const).map((value) => (
            <button key={value} type="button" className={styles.mode} aria-pressed={view === value} onClick={() => onView(value)}>
              {value === 'gallery' ? t('canvasGallery') : t('canvasResult')}
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
