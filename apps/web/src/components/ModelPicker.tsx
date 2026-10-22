'use client';

import { useI18n } from '@/i18n';
import type { ModelSummary } from '@/lib/api-types';
import { formatDuration } from '@/lib/duration';
import styles from './studio.module.css';

export function ModelPicker({
  models,
  selectedId,
  onSelect,
  onlyId,
  loading = false,
  compact = false,
  name = 'model',
  className,
}: {
  models: ModelSummary[];
  loading?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The showcase has clips of one model: the others stay visible, marked "local only". */
  onlyId?: string;
  /** By Generate: each tier and its time on one pill, what the chosen one buys under them. */
  compact?: boolean;
  /** The radio group's name: two pickers on a page (one per screen size) must not share it. */
  name?: string;
  className?: string;
}) {
  const { t } = useI18n();
  if (compact) {
    const chosen = models.find((model) => model.id === selectedId);
    return (
      <fieldset className={`${styles.modelChoice} ${className ?? ''}`}>
        <legend className="visually-hidden">{t('model')}</legend>
        <div className={styles.canvasViews}>
          {models.map((model) => {
            const localOnly = onlyId !== undefined && model.id !== onlyId;
            return (
              <label key={model.id} className={styles.mode} data-selected={model.id === selectedId} data-disabled={localOnly}>
                <input
                  type="radio"
                  name={name}
                  className="visually-hidden"
                  checked={model.id === selectedId}
                  disabled={localOnly}
                  onChange={() => onSelect(model.id)}
                />
                {model.tier === 'quality' ? t('tierQuality') : t('tierFast')} ·{' '}
                {localOnly ? t('showcaseLocalOnly') : onlyId === undefined ? `~${formatDuration(model.estimate_s['480p'])}` : model.name}
              </label>
            );
          })}
        </div>
        {chosen && <p className={styles.modelHintLine}>{chosen.tier === 'quality' ? t('tierQualityHint') : t('tierFastHint')}</p>}
      </fieldset>
    );
  }
  return (
    <fieldset className={`${styles.panelSection} ${className ?? ''}`}>
      <legend className={styles.sectionTitle}>{t('model')}</legend>
      <div className={styles.models} aria-busy={loading}>
        {loading && [0, 1].map((i) => <span key={i} className={styles.modelSkeleton} aria-hidden="true" />)}
        {models.map((model) => {
          const localOnly = onlyId !== undefined && model.id !== onlyId;
          return (
            <label key={model.id} className={styles.model} data-selected={model.id === selectedId} data-disabled={localOnly}>
              <input
                type="radio"
                name={name}
                className="visually-hidden"
                checked={model.id === selectedId}
                disabled={localOnly}
                onChange={() => onSelect(model.id)}
              />
              <span className={styles.modelTier}>{model.tier === 'quality' ? t('tierQuality') : t('tierFast')}</span>
              <span className={styles.modelName}>{model.name}</span>
              <span className={styles.modelMeta}>
                <span className={styles.license}>{model.license}</span>
                {/* The showcase plays clips: no render time to announce. */}
                {localOnly ? <span>{t('showcaseLocalOnly')}</span> : onlyId === undefined && <span>~{formatDuration(model.estimate_s['480p'])}</span>}
              </span>
              {/* What the time buys: the quality model follows the poses, the fast one the move's text. */}
              <span className={styles.modelHint}>{model.tier === 'quality' ? t('tierQualityHint') : t('tierFastHint')}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
