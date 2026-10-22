'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { catalogText, useI18n } from '@/i18n';
import type { PresetSummary } from '@/lib/api-types';
import { MoveGlyph } from './MoveGlyph';
import styles from './studio.module.css';

/** In a sequence a tile adds a shot: the shots it already is, and the number the next one would take (null when full). */
export type SequenceTiles = { shotsOf: (presetId: string) => number[]; nextShot: number | null };

function PresetTile({
  preset,
  selected,
  paused,
  sequence,
  onSelect,
}: {
  preset: PresetSummary;
  selected: boolean;
  paused: boolean;
  sequence?: SequenceTiles;
  onSelect: () => void;
}) {
  const { t, lang } = useI18n();
  const text = catalogText(lang, preset);
  const id = useId();
  const [previewReady, setPreviewReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // No autoplay attribute: the clip plays only while the previews run.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, preset.previewUrl]);

  const shots = sequence?.shotsOf(preset.id) ?? [];
  return (
    <button
      type="button"
      className={styles.tile}
      aria-labelledby={`${id}-name`}
      aria-describedby={sequence ? `${id}-caption ${id}-shots` : `${id}-caption`}
      // A single shot selects one move; a sequence adds shots, nothing stays pressed.
      aria-pressed={sequence ? undefined : selected}
      data-full={sequence?.nextShot === null}
      onClick={onSelect}
    >
      <span className={styles.tileMedia} data-shape="wide">
        {sequence && (
          <span className={styles.shotMarks} aria-hidden="true">
            {shots.map((n) => (
              <span key={n} className={styles.shotMark}>
                {n}
              </span>
            ))}
            {sequence.nextShot !== null && <span className={styles.shotAdd}>+</span>}
          </span>
        )}
        <MoveGlyph poses={preset.poses} speed={preset.speed} />
        {preset.previewUrl && (
          <video
            ref={video}
            className={styles.presetPreview}
            data-ready={previewReady}
            src={preset.previewUrl}
            poster={preset.posterUrl}
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
        <span id={`${id}-name`} className={styles.tileName}>
          {text.name}
        </span>
      </span>
      <span id={`${id}-caption`} className={styles.tileCaption}>
        {text.description}
      </span>
      {sequence && (
        <span id={`${id}-shots`} className="visually-hidden">
          {shots.length > 0 && t('inShots', { list: shots.join(', ') })}{' '}
          {sequence.nextShot === null ? t('shotsFull') : t('addAsShot', { i: sequence.nextShot })}
        </span>
      )}
    </button>
  );
}

/** Tiles drawn while the catalogue loads: the gallery keeps its shape instead of jumping in. */
const SKELETON_TILES = 6;

export function PresetGallery({
  presets,
  catalog = 'ready',
  selectedId,
  paused,
  onPause,
  sequence,
  onSelect,
}: {
  presets: PresetSummary[];
  catalog?: 'loading' | 'ready' | 'failed';
  selectedId: string | null;
  /** The looping previews are stopped (the toggle, or reduced motion). */
  paused: boolean;
  onPause: (paused: boolean) => void;
  /** Sequence mode: tiles add shots. */
  sequence?: SequenceTiles;
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
          className={styles.toolButton}
          aria-label={paused ? t('motionPlayLabel') : t('motionPauseLabel')}
          onClick={() => onPause(!paused)}
        >
          <span className={styles.motionIcon} data-paused={paused} aria-hidden="true" />
          {paused ? t('motionPlay') : t('motionPause')}
        </button>
      </div>
      {catalog === 'failed' && <p className={styles.hint}>{t('catalogFailed')}</p>}
      <div className={styles.presetGrid} aria-busy={catalog === 'loading'}>
        {catalog === 'loading' &&
          Array.from({ length: SKELETON_TILES }, (_, i) => <span key={i} className={styles.presetSkeleton} aria-hidden="true" />)}
        {presets.map((preset) => (
          <PresetTile
            key={preset.id}
            preset={preset}
            selected={preset.id === selectedId}
            paused={paused}
            sequence={sequence}
            onSelect={() => onSelect(preset.id)}
          />
        ))}
      </div>
    </section>
  );
}
