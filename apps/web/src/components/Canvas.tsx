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
  return (
    <section className={styles.stage} aria-label={t('monitor')}>
      {view !== 'atelier' && (
        <div className={styles.canvasViews} role="group" aria-label={t('canvasViews')}>
          {(['gallery', 'result'] as const).map((value) => (
            <button key={value} type="button" className={styles.mode} aria-pressed={view === value} onClick={() => onView(value)}>
              {value === 'gallery' ? t('canvasGallery') : t('canvasResult')}
            </button>
          ))}
        </div>
      )}
      {view === 'gallery' && <div className={styles.canvasGallery}>{gallery}</div>}
      {/* Kept mounted out of view: a render in progress keeps its monitor, its focus and its live region. */}
      <div className={styles.canvasResult} hidden={view !== 'result'}>
        {result}
        {recent}
      </div>
      {view === 'atelier' && atelier}
    </section>
  );
}
