'use client';

import { useI18n } from '@/i18n';
import { IS_SHOWCASE } from '@/lib/api';
import { useShowcase } from '@/lib/use-showcase';
import styles from './studio.module.css';

/**
 * The showcase says what it is, and where its source code lives (AGPL-3.0 §13:
 * users of the network service get the source). Outside the showcase: nothing.
 */
export function ShowcaseFooter() {
  const { t } = useI18n();
  const showcase = useShowcase();
  if (!IS_SHOWCASE) return null;
  const repoUrl = showcase?.repoUrl;
  return (
    <footer className={styles.footer}>
      <p>{t('showcaseFooter')}</p>
      <p className={styles.footerLinks}>
        {repoUrl ? (
          <>
            <a href={repoUrl} rel="noreferrer">
              {t('showcaseSource')}
            </a>
            <a href={repoUrl} rel="noreferrer">
              {t('showcaseRunLocally')}
            </a>
          </>
        ) : (
          showcase && <span>{t('showcaseSourcePending')}</span>
        )}
      </p>
    </footer>
  );
}
