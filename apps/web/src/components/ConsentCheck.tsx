'use client';

import { useI18n, type MessageKey } from '@/i18n';
import styles from './studio.module.css';

/**
 * Before an edit, an effect, a hook or an avatar on an imported photo: the person agreed. On the
 * Motion tab the same box says the user holds the rights on the video and the photo (label).
 */
export function ConsentCheck({
  id,
  checked,
  onChange,
  label = 'consentLabel',
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: MessageKey;
}) {
  const { t } = useI18n();
  return (
    <label className={styles.consent} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{t(label)}</span>
    </label>
  );
}
