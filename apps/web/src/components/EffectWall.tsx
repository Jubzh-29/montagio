'use client';

import { useId, useRef, useState } from 'react';
import { catalogText, useI18n } from '@/i18n';
import type { EffectSummary, HookSummary } from '@/lib/api-types';
import { wallFilter, type WallFilter } from '@/lib/effect-choice';
import { usePlayWhileSeen } from '@/lib/use-play-while-seen';
import styles from './studio.module.css';

/** One tile of the wall: its preview looping (never a missing file), its name over it, what it does under it. */
function WallTile({
  name,
  description,
  previewUrl,
  posterUrl,
  kind,
  selected,
  paused,
  onSelect,
}: {
  name: string;
  description: string;
  previewUrl?: string;
  /** The still shown until the clip plays: no black tile while it loads. */
  posterUrl?: string;
  kind: 'effect' | 'hook';
  selected: boolean;
  paused: boolean;
  onSelect: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const id = useId();
  usePlayWhileSeen(video, paused, previewUrl);
  return (
    <button
      type="button"
      className={styles.tile}
      aria-pressed={selected}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-caption`}
      data-kind={kind}
      onClick={onSelect}
    >
      <span className={styles.tileMedia} data-shape="tall">
      {previewUrl ? (
        <video ref={video} className={styles.wallVideo} src={previewUrl} poster={posterUrl} loop muted playsInline preload="metadata" aria-hidden="true" />
      ) : (
        <span className={styles.wallIcon} aria-hidden="true">
          {kind === 'hook' ? '◎' : '✦'}
        </span>
      )}
      <span id={`${id}-name`} className={styles.tileName}>
        {name}
      </span>
      </span>
      <span id={`${id}-caption`} className={styles.tileCaption}>
        {description}
      </span>
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
  const { t, lang } = useI18n();
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
      {/* The two kinds of the wall, said once where they are filtered. */}
      {hooks.length > 0 && <p className={styles.hint}>{t('hooksHint')}</p>}
      <div className={styles.wall} data-testid="effect-wall">
        {tiles.map((tile) => (
          <WallTile
            key={`${tile.kind}:${tile.id}`}
            name={catalogText(lang, tile.item).name}
            description={catalogText(lang, tile.item).description}
            previewUrl={tile.item.previewUrl}
            posterUrl={tile.item.posterUrl}
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
