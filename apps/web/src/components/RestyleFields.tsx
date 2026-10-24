'use client';

import { useI18n } from '@/i18n';
import type { UploadState } from './Monitor';
import { MotionVideoSlot, type MotionVideo } from './MotionFields';
import styles from './studio.module.css';

/** What the Motion tab does with its clip: a character performs it, or its scene is restyled. */
export type MotionMode = 'character' | 'restyle';

const TEXT_MAX = 500;

/** The two uses of the Motion tab's clip, under its card; shown only when both extensions are. */
export function MotionModeSwitch({ mode, onMode, disabled }: { mode: MotionMode; onMode: (mode: MotionMode) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    // In a section, as the avatar's language: a bare child of the panel's column would be squeezed.
    <div className={styles.panelSection}>
      <div className={styles.canvasViews} role="group" aria-label={t('motionModeLabel')} data-testid="motion-mode">
        <button type="button" className={styles.mode} aria-pressed={mode === 'character'} disabled={disabled} onClick={() => onMode('character')}>
          {t('motionModeCharacter')}
        </button>
        <button type="button" className={styles.mode} aria-pressed={mode === 'restyle'} disabled={disabled} onClick={() => onMode('restyle')}>
          {t('motionModeRestyle')}
        </button>
      </div>
    </div>
  );
}

/**
 * The restyle's fields: the clip (prepared at upload like a motion's), the reference image it is
 * best with (a character, an outfit, a style), then what the scene becomes. Without an image, the
 * clip's first frame is restyled from the text first when the edit is installed; otherwise the text
 * alone drives it, less reliably, which the hint in the slot says.
 */
export function RestyleFields({
  video,
  disabled,
  paused,
  onVideo,
  text,
  onText,
  look,
  onLook,
  onClearLook,
  firstFrame,
}: {
  video: MotionVideo;
  disabled: boolean;
  paused: boolean;
  onVideo: (file: File) => void;
  text: string;
  onText: (value: string) => void;
  look: UploadState;
  onLook: (file: File) => void;
  onClearLook: () => void;
  /** Without a look image, the edit restyles the clip's first frame first. */
  firstFrame: boolean;
}) {
  const { t } = useI18n();
  const lookUrl = look.status === 'idle' ? undefined : look.localUrl;
  return (
    <>
      <MotionVideoSlot
        video={video}
        disabled={disabled}
        paused={paused}
        onVideo={onVideo}
        labels={{ title: 'restyleVideo', empty: 'restyleVideoEmpty', add: 'restyleVideoAdd' }}
      />
      <section className={styles.panelSection} aria-labelledby="restyle-look-title">
        <h2 id="restyle-look-title" className={styles.sectionTitle}>
          {t('restyleLook')}
        </h2>
        <div className={styles.photoSlot} data-testid="restyle-look-slot">
          {lookUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img className={styles.photoThumb} src={lookUrl} alt="" />
          ) : (
            <span className={styles.photoEmpty}>{t(firstFrame ? 'restyleLookEmpty' : 'restyleLookEmptyText')}</span>
          )}
          <div className={styles.photoActions}>
            <input
              id="restyle-look-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onLook(file);
                event.target.value = '';
              }}
            />
            <label htmlFor="restyle-look-input" className={styles.buttonSecondary} aria-disabled={disabled || undefined}>
              {look.status === 'uploading' ? t('uploading') : t('restyleLookAdd')}
            </label>
            {look.status !== 'idle' && (
              <button type="button" className={styles.buttonSecondary} disabled={disabled} onClick={onClearLook}>
                {t('restyleLookRemove')}
              </button>
            )}
          </div>
        </div>
        {look.status === 'error' && (
          <p className={styles.photoError} role="alert">
            {look.message}
          </p>
        )}
      </section>
      <div className={styles.panelSection}>
        <label htmlFor="restyle-text" className={styles.sectionTitle}>
          {t('restyleText')}
        </label>
        <textarea
          id="restyle-text"
          className={styles.prompt}
          rows={2}
          maxLength={TEXT_MAX}
          placeholder={t('restyleTextPlaceholder')}
          value={text}
          aria-required
          onChange={(event) => onText(event.target.value)}
        />
      </div>
    </>
  );
}
