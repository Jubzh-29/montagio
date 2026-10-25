'use client';

import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { useI18n } from '@/i18n';
import type { SampleSummary } from '@/lib/api-types';
import type { BankFace } from '@/lib/character-bank';
import { FacePicker } from './FacePicker';
import type { UploadState } from './Monitor';
import { SamplePicker } from './SamplePicker';
import styles from './studio.module.css';

/**
 * The start photo, in the composer: its thumbnail (a drop zone while empty) and the
 * ways to get one: import, sample, create from a text, edit, or a starting face for the
 * tabs that need a person. In the showcase the sample photos replace the import, unless
 * its `uploads` capability says otherwise.
 */
export function PhotoSource({
  upload,
  disabled,
  onFile,
  onSample,
  onAtelier,
  t2i,
  edit,
  showcase,
  faces,
}: {
  upload: UploadState;
  disabled: boolean;
  onFile: (file: File) => void;
  onSample: () => void;
  onAtelier?: (kind: 't2i' | 'edit' | 'draw') => void;
  t2i: boolean;
  edit: boolean;
  showcase?: {
    samples: SampleSummary[];
    selectedId: string | null;
    onPick: (sample: SampleSummary) => void;
    uploads: boolean;
    onRefusedFile: () => void;
  };
  /** The starting faces, for a tab whose photo is a person or a character. */
  faces?: { list: readonly BankFace[]; selectedId: string | null; onPick: (face: BankFace) => void };
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const localUrl = upload.status === 'idle' ? undefined : upload.localUrl;
  const acceptsFiles = !showcase || showcase.uploads;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (!acceptsFiles) return showcase?.onRefusedFile();
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <section className={styles.panelSection} aria-labelledby="photo-title">
      <h2 id="photo-title" className={styles.sectionTitle}>
        {t('photoTitle')}
      </h2>
      <div
        className={styles.photoSlot}
        data-dragging={dragging}
        data-testid="photo-slot"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {localUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL or sample preview
          <img className={styles.photoThumb} src={localUrl} alt="" />
        ) : (
          <span className={styles.photoEmpty}>{acceptsFiles ? t('photoDrop') : t('showcasePickSample')}</span>
        )}
        <div className={styles.photoActions}>
          {acceptsFiles && (
            <>
              <input
                id="photo-input"
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
              <label htmlFor="photo-input" className={styles.buttonSecondary} aria-disabled={disabled || undefined}>
                {upload.status === 'uploading' ? t('uploading') : t('photoImport')}
              </label>
            </>
          )}
          {!showcase && (
            <button type="button" className={styles.buttonSecondary} onClick={onSample} disabled={disabled}>
              {t('photoSample')}
            </button>
          )}
          {t2i && onAtelier && (
            <button type="button" className={styles.buttonSecondary} onClick={() => onAtelier('t2i')} disabled={disabled}>
              {t('photoT2i')}
            </button>
          )}
          {edit && onAtelier && (
            <button type="button" className={styles.buttonSecondary} onClick={() => onAtelier('edit')} disabled={disabled || upload.status !== 'ready'}>
              {t('photoEdit')}
            </button>
          )}
          {/* Draw to video: a sketch the edit turns into the start photo (the local app only). */}
          {edit && onAtelier && !showcase && (
            <button type="button" className={styles.buttonSecondary} onClick={() => onAtelier('draw')} disabled={disabled}>
              {t('photoDraw')}
            </button>
          )}
          {/* A saved character's pictures come back here from the Characters page, in this tab. */}
          {!showcase && t2i && (
            <Link href="/characters" className={styles.buttonSecondary}>
              {t('photoCharacter')}
            </Link>
          )}
        </div>
      </div>
      {faces && faces.list.length > 0 && (
        <>
          <p className={styles.facesLead}>
            {t('facesStudioLead')}
          </p>
          <FacePicker faces={faces.list} selectedId={faces.selectedId} disabled={disabled} label={t('facesTitle')} onPick={faces.onPick} />
        </>
      )}
      {showcase && <SamplePicker samples={showcase.samples} selectedId={showcase.selectedId} onPick={showcase.onPick} />}
      {upload.status === 'error' && (
        <p className={styles.photoError} role="alert">
          {upload.message}
        </p>
      )}
    </section>
  );
}
