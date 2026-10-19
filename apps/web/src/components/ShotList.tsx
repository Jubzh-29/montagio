'use client';

import { useI18n } from '@/i18n';
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
  const { t } = useI18n();
  const nameOf = (id: string) => presets.find((preset) => preset.id === id)?.name ?? id;
  return (
    <section className={styles.panelSection} aria-labelledby="shots-heading">
      <h2 id="shots-heading" className={styles.sectionTitle}>
        {t('shots')} · {shots.length}/{max}
      </h2>
      {shots.length === 0 ? (
        <p className={styles.hint}>{t('sequenceHint')}</p>
      ) : (
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
        </ol>
      )}
    </section>
  );
}
