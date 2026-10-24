'use client';

import { useEffect, useRef } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import styles from './studio.module.css';

/** The reference clip of a motion transfer, or the clip of a restyle, as the composer shows it. */
export type MotionVideo =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'ready'; videoRef: string; url: string; duration_s?: number; sourceDuration_s?: number }
  | { status: 'error'; message: string };

const TEXT_MAX = 500;

/** The words of a clip slot: the reference video of a motion, or the clip a restyle rebuilds. */
export type VideoSlotLabels = { title: MessageKey; empty: MessageKey; add: MessageKey };
const MOTION_LABELS: VideoSlotLabels = { title: 'motionVideo', empty: 'motionVideoEmpty', add: 'motionVideoAdd' };

/** The clip, prepared at upload (5 s at 16 fps, silent), with the length kept. */
export function MotionVideoSlot({
  video,
  disabled,
  paused,
  onVideo,
  labels = MOTION_LABELS,
}: {
  video: MotionVideo;
  disabled: boolean;
  /** The looping previews are paused (the toggle, or reduced motion): the clip too. */
  paused: boolean;
  onVideo: (file: File) => void;
  labels?: VideoSlotLabels;
}) {
  const { t } = useI18n();
  const preview = useRef<HTMLVideoElement>(null);
  const previewUrl = video.status === 'ready' ? video.url : undefined;
  useEffect(() => {
    const element = preview.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, previewUrl]);
  const seconds = (value: number) => Math.round(value * 10) / 10;
  return (
    <section className={styles.panelSection} aria-labelledby="motion-video-title">
      <h2 id="motion-video-title" className={styles.sectionTitle}>
        {t(labels.title)}
      </h2>
      <div className={styles.photoSlot} data-testid="motion-video-slot">
        {video.status === 'ready' ? (
          <video ref={preview} className={styles.photoThumb} src={video.url} muted loop playsInline aria-hidden="true" />
        ) : (
          <span className={styles.photoEmpty} role="status">
            {video.status === 'uploading' ? t('uploading') : t(labels.empty)}
          </span>
        )}
        <div className={styles.photoActions}>
          <input
            id="motion-video-input"
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="visually-hidden"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onVideo(file);
              event.target.value = '';
            }}
          />
          <label htmlFor="motion-video-input" className={styles.buttonSecondary} aria-disabled={disabled || undefined}>
            {t(labels.add)}
          </label>
        </div>
      </div>
      {video.status === 'ready' && video.duration_s !== undefined && video.sourceDuration_s !== undefined && (
        <p className={styles.hint} data-testid="motion-video-kept">
          {t('motionVideoKept', { kept: seconds(video.duration_s), source: seconds(video.sourceDuration_s) })}
        </p>
      )}
      {video.status === 'error' && (
        <p className={styles.photoError} role="alert">
          {video.message}
        </p>
      )}
    </section>
  );
}

/**
 * The Motion tab's fields: the reference clip (prepared at upload, its kept length shown), and
 * two optional texts, what the character looks like and what it does.
 */
export function MotionFields({
  video,
  disabled,
  paused,
  onVideo,
  character,
  action,
  onCharacter,
  onAction,
}: {
  video: MotionVideo;
  disabled: boolean;
  /** The looping previews are paused (the toggle, or reduced motion): the reference clip too. */
  paused: boolean;
  onVideo: (file: File) => void;
  character: string;
  action: string;
  onCharacter: (value: string) => void;
  onAction: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <MotionVideoSlot video={video} disabled={disabled} paused={paused} onVideo={onVideo} />
      <div className={styles.panelSection}>
        <label htmlFor="motion-character" className={styles.sectionTitle}>
          {t('motionCharacter')}
        </label>
        <input
          id="motion-character"
          className={styles.prompt}
          type="text"
          maxLength={TEXT_MAX}
          placeholder={t('motionCharacterPlaceholder')}
          value={character}
          onChange={(event) => onCharacter(event.target.value)}
        />
        <label htmlFor="motion-action" className={styles.sectionTitle}>
          {t('motionAction')}
        </label>
        <input
          id="motion-action"
          className={styles.prompt}
          type="text"
          maxLength={TEXT_MAX}
          placeholder={t('motionActionPlaceholder')}
          value={action}
          onChange={(event) => onAction(event.target.value)}
        />
      </div>
    </>
  );
}
