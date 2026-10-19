'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import type { PresetSummary } from '@/lib/api-types';
import { MoveGlyph } from './MoveGlyph';
import styles from './studio.module.css';

function PresetTile({
  preset,
  selected,
  paused,
  onSelect,
}: {
  preset: PresetSummary;
  selected: boolean;
  paused: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const [previewReady, setPreviewReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // No autoplay attribute: the clip plays only while the previews run.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, preset.previewUrl]);

  return (
    <button type="button" className={styles.preset} aria-pressed={selected} onClick={onSelect}>
      <span className={styles.presetMedia}>
        <MoveGlyph poses={preset.poses} speed={preset.speed} />
        {preset.previewUrl && (
          <video
            ref={video}
            className={styles.presetPreview}
            data-ready={previewReady}
            src={preset.previewUrl}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedData={() => setPreviewReady(true)}
            onError={() => setPreviewReady(false)}
          />
        )}
        {preset.previewPlaceholder && <span className={styles.badge}>{t('showcasePlaceholderBadge')}</span>}
      </span>
      <span className={styles.presetText}>
        <span className={styles.presetName}>{preset.name}</span>
        <span className={styles.presetDescription}>{preset.description}</span>
      </span>
    </button>
  );
}

export function PresetGallery({
  presets,
  selectedId,
  paused,
  onPause,
  onSelect,
}: {
  presets: PresetSummary[];
  selectedId: string | null;
  /** The looping previews are stopped (the toggle, or reduced motion). */
  paused: boolean;
  onPause: (paused: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.panelSection} aria-labelledby="presets-heading">
      <div className={styles.sectionHead}>
        <h2 id="presets-heading" className={styles.sectionTitle}>
          {t('presets')}
        </h2>
        <button
          type="button"
          className={styles.motionToggle}
          aria-label={paused ? t('motionPlayLabel') : t('motionPauseLabel')}
          onClick={() => onPause(!paused)}
        >
          <span className={styles.motionIcon} data-paused={paused} aria-hidden="true" />
          {paused ? t('motionPlay') : t('motionPause')}
        </button>
      </div>
      <div className={styles.presetGrid}>
        {presets.map((preset) => (
          <PresetTile
            key={preset.id}
            preset={preset}
            selected={preset.id === selectedId}
            paused={paused}
            onSelect={() => onSelect(preset.id)}
          />
        ))}
      </div>
    </section>
  );
}
