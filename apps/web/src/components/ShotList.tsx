'use client';

import { catalogText, useI18n } from '@/i18n';
import type { PresetSummary } from '@/lib/api-types';
import styles from './studio.module.css';

export function ShotList({
  shots,
  presets,
  max,
  onRemove,
  onPromptChange,
  promptsDisabled = false,
}: {
  shots: { presetId: string; prompt: string }[];
  presets: PresetSummary[];
  max: number;
  onRemove: (index: number) => void;
  onPromptChange: (index: number, text: string) => void;
  /** The showcase renders nothing: a shot's text could not change its pre-generated clip. */
  promptsDisabled?: boolean;
}) {
  const { t, lang } = useI18n();
  const nameOf = (id: string) => {
    const preset = presets.find((entry) => entry.id === id);
    return preset ? catalogText(lang, preset).name : id;
  };
  // The slots still free, drawn empty: the film's shape (two shots, a third optional) reads before any click.
  const free = Array.from({ length: max - shots.length }, (_, i) => shots.length + i + 1);
  return (
    <section className={styles.panelSection} aria-labelledby="shots-heading">
      <h2 id="shots-heading" className={styles.sectionTitle}>
        {t('shots')} · {shots.length}/{max}
      </h2>
      <p className={styles.hint}>{shots.length === max ? t('shotsFull') : t('sequenceHint')}</p>
      <ol className={styles.shotList}>
        {shots.map((shot, index) => (
          <li key={`${shot.presetId}-${index}`} className={styles.shot}>
            <span className={styles.shotNumber}>{index + 1}</span>
            <span className={styles.shotName}>{nameOf(shot.presetId)}</span>
            <button
              type="button"
              className={styles.shotRemove}
              aria-label={t('removeShot', { i: index + 1 })}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
            <input
              type="text"
              className={styles.shotPrompt}
              aria-label={t('shotPrompt', { i: index + 1 })}
              placeholder={t('shotPromptPlaceholder')}
              maxLength={300}
              disabled={promptsDisabled}
              value={shot.prompt}
              onChange={(event) => onPromptChange(index, event.target.value)}
            />
          </li>
        ))}
        {free.map((n) => (
          <li key={`free-${n}`} className={styles.shotSlot} aria-hidden="true">
            <span className={styles.shotNumber}>{n}</span>
            <span>{n <= 2 ? t('shotSlot') : t('shotSlotOptional')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
