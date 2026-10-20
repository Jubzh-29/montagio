'use client';

import { useI18n } from '@/i18n';
import type { UploadState } from './Monitor';
import styles from './studio.module.css';

/** The second photo of a two-reference hook (the outfit of Wardrobe Swap): imported, as the start photo can be. */
export function OutfitSource({ outfit, disabled, onFile }: { outfit: UploadState; disabled: boolean; onFile: (file: File) => void }) {
  const { t } = useI18n();
  const localUrl = outfit.status === 'idle' ? undefined : outfit.localUrl;
  return (
    <section className={styles.panelSection} aria-labelledby="outfit-title">
      <h2 id="outfit-title" className={styles.sectionTitle}>
        {t('hookOutfit')}
      </h2>
      <div className={styles.photoSlot} data-testid="outfit-slot">
        {localUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img className={styles.photoThumb} src={localUrl} alt="" />
        ) : (
          <span className={styles.photoEmpty}>{t('hookOutfitEmpty')}</span>
        )}
        <div className={styles.photoActions}>
          <input
            id="outfit-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
          <label htmlFor="outfit-input" className={styles.buttonSecondary} aria-disabled={disabled || undefined}>
            {outfit.status === 'uploading' ? t('uploading') : t('hookOutfitAdd')}
          </label>
        </div>
      </div>
      {outfit.status === 'error' && (
        <p className={styles.photoError} role="alert">
          {outfit.message}
        </p>
      )}
    </section>
  );
}
