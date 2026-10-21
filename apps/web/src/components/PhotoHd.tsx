'use client';

import { useI18n } from '@/i18n';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import styles from './studio.module.css';

/** HD photo: the picture to 2560 px (SeedVR2), then a link to download it. */
export function PhotoHd({ imageRef, estimate, name }: { imageRef: string; estimate: number; name: string }) {
  const { t } = useI18n();
  const { job, refusal, busy, start } = useJob();
  const done = job?.state === 'succeeded' && job.outputUrl ? job : null;
  const failed = refusal || job?.state === 'failed' || job?.state === 'canceled';
  if (done) {
    return (
      <a className={styles.buttonGhost} href={done.outputUrl} download={`montagio-${name}-hd.png`}>
        {t('photoHdDownload')}
      </a>
    );
  }
  return (
    <>
      <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void start('/api/images/upscale', { imageRef })}>
        {busy && job ? t('running', { p: Math.round(job.progress * 100) }) : t('photoHd', { s: estimate })}
      </button>
      {failed && (
        <span className={styles.photoError} role="alert">
          {refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}
        </span>
      )}
    </>
  );
}
