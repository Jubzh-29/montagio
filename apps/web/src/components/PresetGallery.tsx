'use client';

import { useState, type CSSProperties } from 'react';
import { useI18n } from '@/i18n';
import type { PresetSummary } from '@/lib/api-types';
import styles from './studio.module.css';

/** Where the scene drifts inside the viewfinder for each camera pose. */
const POSE_MOTION: Record<string, { tx: number; ty: number; scale: number }> = {
  static: { tx: 0, ty: 0, scale: 1 },
  pan_left: { tx: 14, ty: 0, scale: 1 },
  pan_right: { tx: -14, ty: 0, scale: 1 },
  pan_up: { tx: 0, ty: 14, scale: 1 },
  pan_down: { tx: 0, ty: -14, scale: 1 },
  zoom_in: { tx: 0, ty: 0, scale: 1.55 },
  zoom_out: { tx: 0, ty: 0, scale: 0.7 },
};

function MoveGlyph({ poses, speed }: { poses: string[]; speed: number }) {
  const motion = poses.reduce(
    (acc, pose) => {
      const m = POSE_MOTION[pose] ?? POSE_MOTION.static!;
      return { tx: acc.tx + m.tx, ty: acc.ty + m.ty, scale: acc.scale * m.scale };
    },
    { tx: 0, ty: 0, scale: 1 },
  );
  const style = {
    '--tx': `${motion.tx}%`,
    '--ty': `${motion.ty}%`,
    '--scale': motion.scale,
    '--move-duration': `${(2.6 / Math.max(speed, 0.2)).toFixed(2)}s`,
  } as CSSProperties;
  return (
    <span className={styles.glyph} aria-hidden="true">
      <span className={styles.glyphScene} style={style}>
        <span className={styles.glyphHorizon} />
        <span className={styles.glyphSubject} />
      </span>
      <span className={styles.glyphFrame} />
    </span>
  );
}

function PresetTile({
  preset,
  selected,
  onSelect,
}: {
  preset: PresetSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const [previewReady, setPreviewReady] = useState(false);
  return (
    <button type="button" className={styles.preset} aria-pressed={selected} onClick={onSelect}>
      <span className={styles.presetMedia}>
        <MoveGlyph poses={preset.poses} speed={preset.speed} />
        <video
          className={styles.presetPreview}
          data-ready={previewReady}
          src={preset.previewUrl}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          aria-hidden="true"
          onLoadedData={() => setPreviewReady(true)}
          onError={() => setPreviewReady(false)}
        />
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
  onSelect,
}: {
  presets: PresetSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.panelSection} aria-labelledby="presets-heading">
      <h2 id="presets-heading" className={styles.sectionTitle}>
        {t('presets')}
      </h2>
      <div className={styles.presetGrid}>
        {presets.map((preset) => (
          <PresetTile
            key={preset.id}
            preset={preset}
            selected={preset.id === selectedId}
            onSelect={() => onSelect(preset.id)}
          />
        ))}
      </div>
    </section>
  );
}
