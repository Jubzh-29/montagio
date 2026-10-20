'use client';

import { useI18n } from '@/i18n';
import styles from './studio.module.css';

/** Before an edit, an effect, a hook or an avatar on an imported photo: the person agreed. */
export function ConsentCheck({ id, checked, onChange }: { id: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n();
  return (
    <label className={styles.consent} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{t('consentLabel')}</span>
    </label>
  );
}
