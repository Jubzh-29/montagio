'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import type { EffectSummary, HookSummary } from '@/lib/api-types';
import { wallFilter, type WallFilter } from '@/lib/effect-choice';
import styles from './studio.module.css';

/** One tile of the wall: its preview looping (never a missing file), its name over it. */
function WallTile({
  name,
  previewUrl,
  kind,
  selected,
  paused,
  onSelect,
}: {
  name: string;
  previewUrl?: string;
  kind: 'effect' | 'hook';
  selected: boolean;
  paused: boolean;
  onSelect: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, previewUrl]);
  return (
    <button type="button" className={styles.wallTile} aria-pressed={selected} data-kind={kind} onClick={onSelect}>
      {previewUrl ? (
        <video ref={video} className={styles.wallVideo} src={previewUrl} loop muted playsInline preload="metadata" aria-hidden="true" />
      ) : (
        <span className={styles.wallIcon} aria-hidden="true">
          {kind === 'hook' ? '◎' : '✦'}
        </span>
      )}
      <span className={styles.wallName}>{name}</span>
    </button>
  );
}

/** The Effects tab's wall: the one-photo effects, then the hooks, as big looping tiles. */
export function EffectWall({
  effects,
  hooks,
  selectedId,
  paused,
  onPause,
  onSelect,
}: {
  effects: EffectSummary[];
  hooks: HookSummary[];
  selectedId: string | null;
  paused: boolean;
  /** The same pause as the Camera wall's (WCAG 2.2.2): the tiles and the choice card stop with it. */
  onPause: (paused: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<WallFilter>('all');
  const tiles = wallFilter(effects, hooks, hooks.length > 0 ? filter : 'effects');
  return (
    <section className={styles.panelSection} aria-labelledby="wall-title">
      <div className={styles.sectionHead}>
        <h2 id="wall-title" className={styles.sectionTitle}>
          {t('effectsTitle')}
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
      {hooks.length > 0 && (
        <div className={styles.canvasViews} role="group" aria-label={t('effectsTitle')}>
          {(
            [
              ['all', 'effectsFilterAll'],
              ['effects', 'effectsFilterEffects'],
              ['hooks', 'effectsFilterHooks'],
            ] as const
          ).map(([value, key]) => (
            <button key={value} type="button" className={styles.mode} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {t(key)}
            </button>
          ))}
        </div>
      )}
      <div className={styles.wall}>
        {tiles.map((tile) => (
          <WallTile
            key={`${tile.kind}:${tile.id}`}
            name={tile.item.name}
            previewUrl={tile.item.previewUrl}
            kind={tile.kind}
            selected={selectedId === tile.id}
            paused={paused}
            onSelect={() => onSelect(tile.id)}
          />
        ))}
      </div>
    </section>
  );
}
