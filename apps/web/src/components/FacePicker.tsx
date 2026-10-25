'use client';

import { useI18n } from '@/i18n';
import { facePicture, type BankFace } from '@/lib/character-bank';
import styles from './studio.module.css';

/**
 * The starting faces, as a row of thumbnails: one click and the face stands in for a photo. Large on
 * the Characters page (a grid, names shown), compact under the Studio's start photo (one scrolling row).
 */
export function FacePicker({
  faces,
  selectedId,
  disabled = false,
  size = 'compact',
  label,
  onPick,
}: {
  faces: readonly BankFace[];
  selectedId: string | null;
  disabled?: boolean;
  size?: 'compact' | 'large';
  label?: string;
  onPick?: (face: BankFace) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className={styles.faces} data-size={size} aria-label={label ?? t('facesTitle')}>
      {faces.map((face) => (
        <li key={face.id}>
          {onPick ? (
            <button type="button" className={styles.face} aria-pressed={selectedId === face.id} disabled={disabled} onClick={() => onPick(face)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a starting face's thumbnail */}
              <img src={facePicture(face.id)} alt="" loading="lazy" width={240} height={320} />
              <span className={styles.faceName}>{face.name}</span>
            </button>
          ) : (
            <figure className={styles.face}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a starting face's thumbnail */}
              <img src={facePicture(face.id)} alt="" loading="lazy" width={240} height={320} />
              <figcaption className={styles.faceName}>{face.name}</figcaption>
            </figure>
          )}
        </li>
      ))}
    </ul>
  );
}
