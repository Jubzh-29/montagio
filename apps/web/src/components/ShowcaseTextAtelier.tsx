'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n';
import type { AtelierPhoto } from './PhotoAtelier';
import styles from './studio.module.css';

/**
 * The showcase's Text to image (spec §8): the texts the sample photos were made from. Picking
 * one shows its photo, made in advance; nothing is generated, and the note says so.
 */
export function ShowcaseTextAtelier({
  texts,
  model,
  onUse,
  onClose,
}: {
  texts: { prompt: string; imageRef: string; url: string }[];
  model: { name: string; license: string };
  onUse: (photo: AtelierPhoto) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked === null ? undefined : texts[picked];
  return (
    <section className={styles.atelier} aria-labelledby="atelier-title">
      <div className={styles.atelierHead}>
        <h2 id="atelier-title" className={styles.atelierTitle}>
          {t('t2iTitle')}
        </h2>
        <button type="button" className={styles.buttonGhost} onClick={onClose}>
          {t('atelierClose')}
        </button>
      </div>
      <p className={styles.hint}>{t('showcaseT2iNote', { model: model.name, license: model.license })}</p>
      <div className={styles.lookChoice} role="radiogroup" aria-label={t('showcaseT2iPick')}>
        {texts.map((text, index) => (
          <button key={text.imageRef} type="button" role="radio" className={styles.mode} aria-checked={picked === index} onClick={() => setPicked(index)}>
            {text.prompt}
          </button>
        ))}
      </div>
      {chosen && (
        <>
          <div className={styles.atelierImages}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- a sample photo of the showcase */}
              <img src={chosen.url} alt="" data-testid="atelier-result" />
              <figcaption data-testid="ai-caption">{t('aiCaption', { model: model.name, license: model.license })}</figcaption>
            </figure>
          </div>
          <div className={styles.atelierActions}>
            <button type="button" className={styles.buttonSecondary} onClick={() => onUse({ imageRef: chosen.imageRef, url: chosen.url, personal: false, prompt: chosen.prompt })}>
              {t('photoUse')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
