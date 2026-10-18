'use client';

import { useI18n } from '@/i18n';
import type { ModelSummary } from '@/lib/api-types';
import styles from './studio.module.css';

export function ModelPicker({
  models,
  selectedId,
  onSelect,
  onlyId,
}: {
  models: ModelSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The showcase has clips of one model: the others stay visible, marked "local only". */
  onlyId?: string;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={styles.panelSection}>
      <legend className={styles.sectionTitle}>{t('model')}</legend>
      <div className={styles.models}>
        {models.map((model) => {
          const localOnly = onlyId !== undefined && model.id !== onlyId;
          return (
            <label key={model.id} className={styles.model} data-selected={model.id === selectedId} data-disabled={localOnly}>
              <input
                type="radio"
                name="model"
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
                {localOnly ? <span>{t('showcaseLocalOnly')}</span> : onlyId === undefined && <span>~{model.estimate_s['480p']} s</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
