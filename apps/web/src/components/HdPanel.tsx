'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n';
import { formatDuration } from '@/lib/duration';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { AiCaption } from './AiCaption';
import styles from './studio.module.css';

/**
 * Under a finished clip: its 1080p version (SeedVR2), a clip of its own; the 480p one stays.
 * Smooth (ticked by default), RIFE puts a frame between each two: 16 fps clips come out at 32.
 */
export function HdPanel({ path, estimate_s, model }: { path: string; estimate_s: number; model: { name: string; license: string } }) {
  const { t } = useI18n();
  const { job, refusal, busy, start, cancel } = useJob();
  const [smooth, setSmooth] = useState(true);
  const done = job?.state === 'succeeded' && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const percent = job ? Math.round(job.progress * 100) : 0;
  return (
    <div className={styles.panelSection}>
      {!done && (
        <label className={styles.consent}>
          <input type="checkbox" checked={smooth} disabled={busy} onChange={(event) => setSmooth(event.target.checked)} data-testid="hd-smooth" />
          <span>{t('hdSmooth')}</span>
        </label>
      )}
      <div className={styles.actions}>
        {!done && (
          <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void start(path, { smooth })}>
            {t('hdAction', { d: formatDuration(estimate_s) })}
          </button>
        )}
        {busy && job && (
          <button type="button" className={styles.buttonGhost} onClick={() => void cancel()}>
            {t('cancel')}
          </button>
        )}
        {done && (
          <a className={styles.buttonSecondary} href={done.outputUrl} download="montagio-hd.mp4">
            {t('hdDownload')}
          </a>
        )}
      </div>
      {busy && job && (
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
          <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      {(refusal || failed) && (
        <p className={styles.photoError} role="alert">
          {refusal ? t(refusalMessageKey(refusal)) : job?.state === 'canceled' ? t('canceled') : t('failed', { error: job?.error ?? '?' })}
        </p>
      )}
      {done && (
        <AiCaption testId="hd-caption" model={model} />
      )}
    </div>
  );
}
