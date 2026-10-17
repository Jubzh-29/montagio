'use client';

import type { RefObject } from 'react';
import { useI18n } from '@/i18n';
import styles from './studio.module.css';

/** The outcome of "Check preset" (or of a refused "Generate remix"). */
export type RemixCheck =
  | { kind: 'checking' }
  | { kind: 'valid'; name: string }
  | { kind: 'problems'; problems: string[] }
  | { kind: 'too-large' }
  | { kind: 'error' };

/** A copy of the edited text, saved by the browser: nothing is sent to the server. */
function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RemixEditor({
  baseId,
  baseName,
  text,
  original,
  check,
  textareaRef,
  onChange,
  onCheck,
  onReset,
  onClose,
}: {
  baseId: string;
  baseName: string;
  text: string;
  original: string;
  check?: RemixCheck;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (text: string) => void;
  onCheck: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <section id="remix-editor" className={styles.panelSection} aria-labelledby="remix-heading">
      <h2 id="remix-heading" className={styles.sectionTitle}>
        {t('remixTitle', { name: baseName })}
      </h2>
      <label htmlFor="remix-yaml" className={styles.remixLabel}>
        {t('remixYaml')}
      </label>
      <textarea
        id="remix-yaml"
        ref={textareaRef}
        className={styles.remixText}
        rows={16}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-describedby="remix-status"
        aria-invalid={check?.kind === 'problems' || check?.kind === 'too-large' ? true : undefined}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.remixActions}>
        <button type="button" className={styles.buttonSecondary} onClick={onCheck} disabled={check?.kind === 'checking'}>
          {t('remixCheck')}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={() => downloadText(text, `montagio-preset-${baseId}-remix.yaml`)}
        >
          {t('remixDownload')}
        </button>
        <button type="button" className={styles.buttonGhost} onClick={onReset} disabled={text === original}>
          {t('remixReset')}
        </button>
        <button type="button" className={styles.buttonGhost} onClick={onClose}>
          {t('remixClose')}
        </button>
      </div>
      <div id="remix-status" className={styles.remixStatus} aria-live="polite">
        {check?.kind === 'valid' && <p className={styles.remixValid}>{t('remixValid', { name: check.name })}</p>}
        {check?.kind === 'problems' && (
          <>
            <p>{t('remixProblems')}</p>
            <ul className={styles.remixProblems}>
              {check.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          </>
        )}
        {check?.kind === 'too-large' && <p>{t('remixTooLarge')}</p>}
        {check?.kind === 'error' && <p>{t('errorGeneric')}</p>}
      </div>
    </section>
  );
}
