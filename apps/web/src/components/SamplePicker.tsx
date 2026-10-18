'use client';

import { useI18n } from '@/i18n';
import type { SampleSummary } from '@/lib/api-types';
import styles from './studio.module.css';

/** The showcase's sample photos: picking one replaces an upload (nothing is sent anywhere). */
export function SamplePicker({
  samples,
  selectedId,
  onPick,
}: {
  samples: SampleSummary[];
  selectedId: string | null;
  onPick: (sample: SampleSummary) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className={styles.samples} role="group" aria-label={t('showcasePickSample')}>
      {samples.map((sample) => (
        <button
          key={sample.id}
          type="button"
          className={styles.sample}
          aria-pressed={sample.id === selectedId}
          onClick={() => onPick(sample)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer */}
          <img className={styles.sampleImage} src={sample.url} alt="" data-aspect={sample.aspect} />
          <span className={styles.sampleTitle}>{sample.title[lang]}</span>
          {sample.placeholder && <span className={styles.badge}>{t('showcasePlaceholderBadge')}</span>}
        </button>
      ))}
    </div>
  );
}
