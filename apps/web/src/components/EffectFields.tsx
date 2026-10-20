'use client';

import { useI18n } from '@/i18n';
import styles from './studio.module.css';

/** What the photo shows, for the effect's prompt; optional: left empty, the effect's own default is used. */
export function EffectFields({
  subject,
  max,
  onSubject,
  disabled = false,
}: {
  subject: string;
  max: number;
  onSubject: (value: string) => void;
  /** The showcase plays pre-rendered examples: the field says so instead of being ignored. */
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.panelSection}>
      <label htmlFor="effect-subject" className={styles.sectionTitle}>
        {t('effectSubject')}
      </label>
      <input
        id="effect-subject"
        className={styles.prompt}
        type="text"
        maxLength={max}
        placeholder={t('effectSubjectPlaceholder')}
        value={subject}
        disabled={disabled}
        aria-describedby={disabled ? 'effect-subject-count effect-subject-local' : 'effect-subject-count'}
        onChange={(event) => onSubject(event.target.value)}
      />
      <p id="effect-subject-count" className={styles.counter}>
        {t('charCount', { n: subject.length, max })}
      </p>
      {disabled && (
        <p id="effect-subject-local" className={styles.hint}>
          {t('showcaseSubjectLocal')}
        </p>
      )}
    </div>
  );
}
