'use client';

import { useState, type CSSProperties, type DragEvent, type RefObject } from 'react';
import { useI18n } from '@/i18n';
import type { JobState, SampleSummary } from '@/lib/api-types';
import { photoTarget } from '@/lib/move-glyph';
import { refusalMessageKey } from '@/lib/refusals';
import { MoveGlyph } from './MoveGlyph';
import styles from './studio.module.css';

/** What the monitor needs from a generation or a sequence. */
export type TrackedJob = { id: string; state: JobState; progress: number; outputUrl?: string; error?: string };

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; localUrl: string }
  /** `personal`: imported, or made from an imported photo; an effect on it asks for consent. */
  | { status: 'ready'; localUrl: string; imageRef: string; personal: boolean }
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
  move,
  announcement,
  statusRef,
  autoPlayResult = true,
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
  /** The chosen camera move: the empty monitor plays it in its viewfinder. */
  move?: { id: string; poses: string[]; speed: number };
  /** Stage changes for screen readers ("Rendering", "Clip ready"), never the running percentage. */
  announcement: string;
  /** The render status line: the Studio moves the focus there when the visitor starts a render. */
  statusRef?: RefObject<HTMLDivElement | null>;
  /** Off for a clip the visitor did not ask for while the previews are paused (reduced motion). */
  autoPlayResult?: boolean;
  /**
   * The showcase: sample photos replace the drop zone. Unless it takes uploads (its
   * `uploads` capability, off in the static showcase), a dropped file is answered
   * with `onRefusedFile` (an explanation).
   */
  showcase?: {
    samples: SampleSummary[];
    selectedId: string | null;
    onPick: (sample: SampleSummary) => void;
    uploads: boolean;
    onOtherSample: () => void;
    onRefusedFile: () => void;
  };
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  // The photo's own shape, so the target frame sits on the picture and not on its pillarbox.
  const [photoAspect, setPhotoAspect] = useState(16 / 9);
  const localUrl = upload.status === 'idle' ? undefined : upload.localUrl;
  const record = generation.status === 'tracking' ? generation.record : undefined;
  const rendering =
    generation.status === 'submitting' || (record !== undefined && (record.state === 'queued' || record.state === 'running'));
  const percent = record ? Math.round(record.progress * 100) : 0;
  const result = record?.state === 'succeeded' ? record.outputUrl : undefined;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (rendering) return;
    if (showcase && !showcase.uploads) return showcase.onRefusedFile();
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
      {result ? (
        <video
          key={result}
          data-testid="result"
          className={styles.monitorMedia}
          src={result}
          autoPlay={autoPlayResult}
          loop
          muted
          playsInline
          controls
        />
      ) : localUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img
          className={styles.monitorMedia}
          data-dimmed={rendering}
          src={localUrl}
          alt=""
          onLoad={(event) => setPhotoAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || 16 / 9)}
        />
      ) : (
        <>
          {move && <MoveGlyph variant="monitor" poses={move.poses} speed={move.speed} replay={move.id} />}
          {showcase ? (
            <div className={styles.monitorEmpty}>
              {/* The sample photos are in the composer, beside the photo slot. */}
              <p className={styles.monitorEmptyTitle}>{t('showcasePickSample')}</p>
              {showcase.uploads && (
                <label htmlFor="photo-input" className={styles.buttonSecondary}>
                  {t('choosePhoto')}
                </label>
              )}
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
        </>
      )}

      {localUrl && !result && !rendering && move && <PhotoPlan move={move} aspect={photoAspect} />}

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
          <div className={styles.renderStatus} ref={statusRef} tabIndex={-1}>
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
        // A cancel is the user's own doing: a plain notice. Everything else failed: the error tone.
        <div className={styles.monitorNotice} role="alert" data-tone={record?.state === 'canceled' ? 'neutral' : 'error'}>
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

      {/* One quiet live region: it speaks when a render starts and when it is ready, not on every poll. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The chosen move over the user's photo, as on a shot plan: the dashed frame is
 * where the shot ends. A pull back ends wider than the photo: its corners point out.
 */
function PhotoPlan({ move, aspect }: { move: { id: string; poses: string[]; speed: number }; aspect: number }) {
  const { left, top, width, height, widens } = photoTarget(move.poses, move.speed);
  // Played once when the move changes: the frame travels from the whole photo to where the shot ends.
  const from = {
    '--from-x': `${((50 - (left + width / 2)) / width) * 100}%`,
    '--from-y': `${((50 - (top + height / 2)) / height) * 100}%`,
    '--from-sx': 100 / width,
    '--from-sy': 100 / height,
  };
  return (
    <div className={styles.photoPlan} style={{ '--aspect': aspect } as CSSProperties} aria-hidden="true">
      {widens ? (
        <span key={move.id} className={styles.planWiden}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
            <span key={corner} className={styles.planArrow} data-corner={corner}>
              {{ tl: '↖', tr: '↗', bl: '↙', br: '↘' }[corner]}
            </span>
          ))}
        </span>
      ) : (
        <span
          key={move.id}
          className={styles.planTarget}
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, ...from } as CSSProperties}
        />
      )}
    </div>
  );
}
