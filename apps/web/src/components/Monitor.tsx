'use client';

import { useState, type DragEvent } from 'react';
import { useI18n } from '@/i18n';
import type { JobState, SampleSummary } from '@/lib/api-types';
import { refusalMessageKey } from '@/lib/refusals';
import { SamplePicker } from './SamplePicker';

/** What the monitor needs from a generation or a sequence. */
export type TrackedJob = { id: string; state: JobState; progress: number; outputUrl?: string; error?: string };
import styles from './studio.module.css';

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; localUrl: string }
  | { status: 'ready'; localUrl: string; imageRef: string }
  | { status: 'error'; message: string; localUrl?: string };

export type GenerationState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'tracking'; record: TrackedJob }
  | { status: 'error'; message: string };

export function Monitor({
  upload,
  generation,
  onFile,
  onSample,
  onCancel,
  onRetry,
  statusLabel,
  showcase,
}: {
  upload: UploadState;
  generation: GenerationState;
  onFile: (file: File) => void;
  onSample: () => void;
  onCancel: () => void;
  onRetry: () => void;
  /** Replaces the default running text, e.g. "Shot 2/3 — 40%". */
  statusLabel?: string;
  /**
   * The static showcase takes no upload: sample photos replace the drop zone,
   * and a dropped file is answered with `onRefusedFile` (an explanation).
   */
  showcase?: {
    samples: SampleSummary[];
    selectedId: string | null;
    note: string;
    onPick: (sample: SampleSummary) => void;
    onOtherSample: () => void;
    onRefusedFile: () => void;
  };
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const localUrl = upload.status === 'idle' ? undefined : upload.localUrl;
  const record = generation.status === 'tracking' ? generation.record : undefined;
  const rendering =
    generation.status === 'submitting' || (record !== undefined && (record.state === 'queued' || record.state === 'running'));
  const percent = record ? Math.round(record.progress * 100) : 0;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (rendering) return;
    if (showcase) return showcase.onRefusedFile();
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={styles.monitor}
      data-testid="monitor"
      data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {!showcase && (
        <input
          id="photo-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="visually-hidden"
          disabled={rendering}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
      )}

      {record?.state === 'succeeded' && record.outputUrl ? (
        <video
          key={record.outputUrl}
          data-testid="result"
          className={styles.monitorMedia}
          src={record.outputUrl}
          autoPlay
          loop
          muted
          playsInline
          controls
        />
      ) : localUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img className={styles.monitorMedia} data-dimmed={rendering} src={localUrl} alt="" />
      ) : showcase ? (
        <div className={styles.monitorEmpty}>
          <p className={styles.monitorEmptyTitle}>{t('showcasePickSample')}</p>
          <SamplePicker samples={showcase.samples} selectedId={showcase.selectedId} onPick={showcase.onPick} />
          <p className={styles.monitorEmptyHint}>{showcase.note}</p>
        </div>
      ) : (
        <div className={styles.monitorEmpty}>
          <p className={styles.monitorEmptyTitle}>{t('monitorEmpty')}</p>
          <p className={styles.monitorEmptyHint}>{t('monitorEmptyHint')}</p>
          <div className={styles.emptyActions}>
            <label htmlFor="photo-input" className={styles.buttonSecondary}>
              {t('choosePhoto')}
            </label>
            <button type="button" className={styles.buttonLink} onClick={onSample}>
              {t('useSample')}
            </button>
          </div>
        </div>
      )}

      {localUrl && !rendering && !showcase && (
        <label htmlFor="photo-input" className={`${styles.buttonGhost} ${styles.replace}`}>
          {upload.status === 'uploading' ? t('uploading') : t('replacePhoto')}
        </label>
      )}
      {localUrl && !rendering && showcase && (
        <button type="button" className={`${styles.buttonGhost} ${styles.replace}`} onClick={showcase.onOtherSample}>
          {t('showcaseOtherSample')}
        </button>
      )}

      {rendering && (
        <div className={styles.renderOverlay}>
          <div className={styles.renderStatus} aria-live="polite">
            <span className={styles.recDot} aria-hidden="true" />
            {generation.status === 'submitting' || record?.state === 'queued'
              ? statusLabel ?? t('queued')
              : statusLabel ?? t('running', { p: percent })}
            <button type="button" className={styles.buttonGhost} onClick={onCancel} disabled={!record}>
              {t('cancel')}
            </button>
          </div>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('running', { p: percent })}
          >
            <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
        </div>
      )}

      {(record?.state === 'failed' || record?.state === 'canceled' || generation.status === 'error') && (
        <div className={styles.monitorNotice} role="alert">
          <p>
            {generation.status === 'error'
              ? generation.message
              : record?.state === 'canceled'
                ? t('canceled')
                : record?.error === 'lost'
                  ? t('lost')
                  : refusalMessageKey(record?.error) !== 'errorGeneric'
                    ? t(refusalMessageKey(record?.error))
                    : t('failed', { error: record?.error ?? '?' })}
          </p>
          <button type="button" className={styles.buttonSecondary} onClick={onRetry}>
            {t('tryAgain')}
          </button>
        </div>
      )}

      {upload.status === 'error' && (
        <div className={styles.monitorNotice} role="alert">
          <p>{upload.message}</p>
        </div>
      )}
    </div>
  );
}
