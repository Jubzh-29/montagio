'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n';
import { MoveGlyph } from './MoveGlyph';
import styles from './studio.module.css';

/**
 * The composer's card: what the next render will be (an effect, a hook, a camera move),
 * its preview looping, and "Change", which brings the wall back to the canvas.
 */
export function ChoiceCard({
  name,
  kindLabel,
  previewUrl,
  poses,
  speed,
  icon,
  paused,
  onChange,
}: {
  name: string;
  kindLabel: string;
  previewUrl?: string;
  poses?: string[];
  speed?: number;
  icon: 'camera' | 'effect' | 'hook';
  paused: boolean;
  onChange: () => void;
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
    <section className={styles.choiceCard} aria-labelledby="choice-name">
      <div className={styles.choiceMedia} data-icon={icon}>
        {previewUrl ? (
          <video ref={video} className={styles.choiceVideo} src={previewUrl} loop muted playsInline preload="metadata" aria-hidden="true" />
        ) : poses && speed !== undefined ? (
          <MoveGlyph poses={poses} speed={speed} />
        ) : (
          <span className={styles.choiceIcon} aria-hidden="true">
            {icon === 'hook' ? '◎' : '✦'}
          </span>
        )}
        <span id="choice-name" className={styles.choiceName}>
          {name}
        </span>
      </div>
      <div className={styles.choiceMeta}>
        <span>{kindLabel}</span>
        <button type="button" className={styles.buttonGhost} onClick={onChange}>
          {t('choiceChange')}
        </button>
      </div>
    </section>
  );
}
