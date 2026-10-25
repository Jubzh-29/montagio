'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useI18n } from '@/i18n';
import { MoveGlyph } from './MoveGlyph';
import styles from './studio.module.css';

/**
 * The composer's choice row: what the next render will be (an effect, a hook, a camera move),
 * a small loop of its preview beside its name, and "Change", which brings the wall back to the
 * canvas. One row, as the start photo's: the wall and the monitor show the pictures large.
 */
export function ChoiceCard({
  name,
  kindLabel,
  previewUrl,
  posterUrl,
  poses,
  speed,
  icon,
  paused,
  onChange,
  remix,
  remixRef,
}: {
  name: string;
  kindLabel: string;
  previewUrl?: string;
  posterUrl?: string;
  poses?: string[];
  speed?: number;
  icon: 'camera' | 'effect' | 'hook' | 'avatar' | 'motion';
  paused: boolean;
  /** Brings the wall back; absent on a tab without a wall (Avatar). */
  onChange?: () => void;
  /** A camera move: its YAML opens in the remix editor (the hint says so under the card). */
  remix?: { onOpen: () => void; disabled: boolean };
  /** The Remix button, focused again when the remix editor closes. */
  remixRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, previewUrl]);

  return (
    <section className={styles.choiceCard} aria-labelledby="choice-name" data-testid="choice-card">
      <div className={styles.choiceMedia} data-icon={icon}>
        {previewUrl ? (
          <video ref={video} className={styles.choiceVideo} src={previewUrl} poster={posterUrl} loop muted playsInline preload="metadata" aria-hidden="true" />
        ) : poses && speed !== undefined ? (
          <MoveGlyph poses={poses} speed={speed} />
        ) : (
          <span className={styles.choiceIcon} aria-hidden="true">
            {icon === 'hook' ? '◎' : icon === 'avatar' ? '◉' : icon === 'motion' ? '⇄' : '✦'}
          </span>
        )}
      </div>
      <div className={styles.choiceText}>
        <span id="choice-name" className={styles.choiceName}>
          {name}
        </span>
        <span className={styles.choiceKind}>{kindLabel}</span>
      </div>
      <span className={styles.choiceActions}>
        {remix && (
          <button
            ref={remixRef}
            type="button"
            className={styles.buttonSecondary}
            aria-expanded={false}
            aria-describedby="remix-hint"
            disabled={remix.disabled}
            onClick={remix.onOpen}
          >
            {t('remix')}
          </button>
        )}
        {onChange && (
          <button type="button" className={styles.buttonSecondary} onClick={onChange}>
            {t('choiceChange')}
          </button>
        )}
      </span>
      {remix && (
        <p id="remix-hint" className={styles.hint}>
          {t('remixHint')}
        </p>
      )}
    </section>
  );
}
