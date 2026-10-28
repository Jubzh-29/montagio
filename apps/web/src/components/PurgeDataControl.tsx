'use client';

import { useId, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch } from '@/lib/api';
import { canConfirmPurge } from '@/lib/data-purge';
import { refusalMessageKey } from '@/lib/refusals';
import styles from './history.module.css';

export function PurgeDataControl({ onPurged }: { onPurged: () => void }) {
  const { t, lang } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phrase, setPhrase] = useState('');
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const inputId = useId();
  const confirmed = canConfirmPurge(phrase, lang);

  const submit = async () => {
    if (!confirmed || purging) return;
    setPurging(true);
    setError(null);
    try {
      const res = await apiFetch('/api/data/purge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 204) {
        dialog.current?.close();
        setPhrase('');
        onPurged();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(t(refusalMessageKey(body.error)));
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className={styles.purge}>
      <button type="button" className={styles.actionGhost} onClick={() => dialog.current?.showModal()} data-testid="purge-open">
        {t('purgeOpen')}
      </button>
      <dialog
        ref={dialog}
        className={styles.purgeDialog}
        aria-labelledby={titleId}
        data-testid="purge-dialog"
        onCancel={(event) => {
          if (purging) event.preventDefault();
        }}
      >
        <h2 id={titleId}>{t('purgeTitle')}</h2>
        <p>{t('purgeDescription')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={inputId}>{t('purgeConfirmationLabel')}</label>
          <input
            id={inputId}
            value={phrase}
            disabled={purging}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            data-testid="purge-confirmation"
          />
          {error && (
            <p className={styles.purgeError} role="alert" data-testid="purge-error">
              {error}
            </p>
          )}
          <div className={styles.cardActions}>
            <button type="button" className={styles.actionGhost} disabled={purging} onClick={() => dialog.current?.close()} autoFocus>
              {t('cancel')}
            </button>
            <button type="submit" className={styles.action} disabled={!confirmed || purging} data-testid="purge-submit">
              {purging ? t('purgeWorking') : t('purgeSubmit')}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
