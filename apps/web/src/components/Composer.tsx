import type { ReactNode } from 'react';
import styles from './studio.module.css';

/** The left-hand column: the choice, the photo, the fields, then the one primary action. */
export function Composer({
  label,
  choice,
  photo,
  fields,
  consent,
  generate,
}: {
  label: string;
  choice: ReactNode;
  photo: ReactNode;
  fields: ReactNode;
  consent?: ReactNode;
  generate: ReactNode;
}) {
  return (
    <aside className={styles.panel} aria-label={label}>
      {choice}
      {photo}
      {fields}
      {consent}
      {generate}
    </aside>
  );
}
