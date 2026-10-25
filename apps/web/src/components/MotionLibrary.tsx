'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { LibraryMotionSummary } from '@/lib/api-types';
import styles from './studio.module.css';

/**
 * The motion library under the clip slot: reference motions made by Montagio from fictional
 * characters, so a clip is at hand without filming anyone, and with no rights to clear. Picking one
 * takes it as the clip, as if it had been sent.
 */
export function MotionLibrary({ disabled, pickedId, onPick }: { disabled: boolean; pickedId: string | null; onPick: (motion: LibraryMotionSummary) => void }) {
  const { t, lang } = useI18n();
  const [motions, setMotions] = useState<LibraryMotionSummary[]>([]);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/motions')
      .then((res) => jsonOrThrow<LibraryMotionSummary[]>(res))
      .then((list) => alive && setMotions(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (motions.length === 0) return null;
  return (
    <section className={styles.panelSection} aria-labelledby="motion-library-title">
      <h2 id="motion-library-title" className={styles.sectionTitle}>
        {t('motionLibrary')}
      </h2>
      <p className={styles.hint}>{t('motionLibraryHint')}</p>
      <ul className={styles.libraryGrid} data-testid="motion-library">
        {motions.map((motion) => {
          const name = lang === 'fr' && motion.name_fr ? motion.name_fr : motion.name;
          return (
            <li key={motion.id}>
              <button
                type="button"
                className={styles.libraryTile}
                aria-pressed={pickedId === motion.id}
                disabled={disabled}
                title={lang === 'fr' && motion.description_fr ? motion.description_fr : motion.description}
                onClick={() => onPick(motion)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the motion's poster, a still of its clip */}
                {motion.posterUrl ? <img src={motion.posterUrl} alt="" /> : <span aria-hidden="true" />}
                <span className={styles.libraryName}>{name}</span>
                <span className={styles.libraryMeta}>{t('motionLibraryItem', { s: Math.round(motion.duration_s) })}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
