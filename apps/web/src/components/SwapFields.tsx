'use client';

import { useEffect, useState, type MutableRefObject, type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { maskPoints, type FramePoint } from '@/lib/swap-points';
import { MaskPainter } from './MaskPainter';
import type { UploadState } from './Monitor';
import { MotionVideoSlot, type MotionVideo } from './MotionFields';
import styles from './studio.module.css';

const TEXT_MAX = 500;

/** The first frame of a clip, as an image URL of its own size: the frame the object is painted on. */
function useFirstFrame(videoUrl: string | undefined): string | null {
  const [frame, setFrame] = useState<{ videoUrl: string; url: string } | null>(null);
  useEffect(() => {
    if (!videoUrl) return;
    let alive = true;
    let made: string | null = null;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // At loadeddata the frame at 0 s is decoded: it is drawn as it is, at the clip's own size.
    video.addEventListener(
      'loadeddata',
      () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!alive || !blob) return;
          made = URL.createObjectURL(blob);
          setFrame({ videoUrl, url: made });
        }, 'image/png');
      },
      { once: true },
    );
    video.src = videoUrl;
    return () => {
      alive = false;
      video.removeAttribute('src');
      if (made) URL.revokeObjectURL(made);
    };
  }, [videoUrl]);
  return frame && frame.videoUrl === videoUrl ? frame.url : null;
}

/** The points the tracker follows, from the mask MaskPainter exports (white where painted, the frame's size). */
export async function pointsOfMask(mask: Blob): Promise<FramePoint[]> {
  const bitmap = await createImageBitmap(mask);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return maskPoints(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/**
 * The object swap's fields: the clip (prepared at upload like a motion's), the object to replace
 * painted over its first frame (Montagio follows it through the clip), the photo of the new object
 * (optional: the text alone also works, less faithfully), then what replaces it. A warning stands
 * above all: a real person is not replaced without their word, nor passed off as filmed.
 */
export function SwapFields({
  video,
  disabled,
  paused,
  onVideo,
  onPainted,
  maskExport,
  photo,
  onPhoto,
  onClearPhoto,
  text,
  onText,
  cut = false,
  library,
}: {
  video: MotionVideo;
  disabled: boolean;
  paused: boolean;
  onVideo: (file: File) => void;
  /** Whether anything is painted over the first frame: Generate waits for it. */
  onPainted: (painted: boolean) => void;
  /** Filled by MaskPainter with the function that gives the painted mask. */
  maskExport: MutableRefObject<(() => Promise<Blob | null>) | null>;
  photo: UploadState;
  onPhoto: (file: File) => void;
  onClearPhoto: () => void;
  text: string;
  onText: (value: string) => void;
  /** The clip lasts more than the 5 s a swap uses. */
  cut?: boolean;
  /** The motion library, under the clip slot. */
  library?: ReactNode;
}) {
  const { t } = useI18n();
  const firstFrame = useFirstFrame(video.status === 'ready' ? video.url : undefined);
  const photoUrl = photo.status === 'idle' ? undefined : photo.localUrl;
  return (
    <>
      <p className={styles.hint} role="note" data-testid="swap-people">
        {t('swapPeople')}
      </p>
      <MotionVideoSlot
        video={video}
        disabled={disabled}
        paused={paused}
        onVideo={onVideo}
        labels={{ title: 'swapVideo', empty: 'swapVideoEmpty', add: 'swapVideoAdd' }}
      />
      {library}
      {cut && (
        <p className={styles.hint} data-testid="swap-cut">
          {t('swapFirstSeconds')}
        </p>
      )}
      <section className={styles.panelSection} aria-labelledby="swap-mark-title" data-testid="swap-mark">
        <h2 id="swap-mark-title" className={styles.sectionTitle}>
          {t('swapMark')}
        </h2>
        {firstFrame ? (
          <>
            <p className={styles.hint}>{t('swapMarkHint')}</p>
            <MaskPainter photoUrl={firstFrame} disabled={disabled} onPainted={onPainted} exportRef={maskExport} />
          </>
        ) : (
          <p className={styles.hint} role="status">
            {t(video.status === 'ready' ? 'swapMarkLoading' : 'swapMarkEmpty')}
          </p>
        )}
      </section>
      <section className={styles.panelSection} aria-labelledby="swap-photo-title">
        <h2 id="swap-photo-title" className={styles.sectionTitle}>
          {t('swapPhoto')}
        </h2>
        <div className={styles.photoSlot} data-testid="swap-photo-slot">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img className={styles.photoThumb} src={photoUrl} alt="" />
          ) : (
            <span className={styles.photoEmpty}>{t('swapPhotoEmpty')}</span>
          )}
          <div className={styles.photoActions}>
            <input
              id="swap-photo-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPhoto(file);
                event.target.value = '';
              }}
            />
            <label htmlFor="swap-photo-input" className={styles.buttonSecondary} aria-disabled={disabled || undefined}>
              {photo.status === 'uploading' ? t('uploading') : t('swapPhotoAdd')}
            </label>
            {photo.status !== 'idle' && (
              <button type="button" className={styles.buttonSecondary} disabled={disabled} onClick={onClearPhoto}>
                {t('restyleLookRemove')}
              </button>
            )}
          </div>
        </div>
        {photo.status === 'error' && (
          <p className={styles.photoError} role="alert">
            {photo.message}
          </p>
        )}
      </section>
      <div className={styles.panelSection}>
        <label htmlFor="swap-text" className={styles.sectionTitle}>
          {t('swapText')}
        </label>
        <textarea
          id="swap-text"
          className={styles.prompt}
          rows={2}
          maxLength={TEXT_MAX}
          placeholder={t('swapTextPlaceholder')}
          value={text}
          aria-required
          onChange={(event) => onText(event.target.value)}
        />
      </div>
    </>
  );
}
