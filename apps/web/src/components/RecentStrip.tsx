'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import type { HistoryItem } from '@/lib/api-types';
import { historyName, repriseHref } from '@/lib/reprise';
import styles from './history.module.css';

const SHOWN = 5;

/**
 * Under the result: the last creations, each a way back to it, and the whole history.
 * Out of reach (inert) while a render runs: a Reuse would replace it.
 */
export function RecentStrip({ items, inert = false }: { items: HistoryItem[]; inert?: boolean }) {
  const { t, lang } = useI18n();
  if (items.length === 0) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title" inert={inert} data-testid="recent-strip">
      <h2 id="recent-title" className={styles.recentTitle}>
        {t('historyRecent')}
      </h2>
      <ul className={styles.recentList}>
        {items.slice(0, SHOWN).map((item) => {
          const name = historyName(item, lang) === item.modelName ? t('historyKindPhoto') : historyName(item, lang);
          return (
            <li key={item.key}>
              <Link className={styles.recentItem} href={repriseHref(item)} aria-label={`${t('historyReuse')}: ${name}`}>
                {item.kind === 'photo' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local media URL
                  <img src={item.previewUrl} alt="" loading="lazy" />
                ) : (
                  // Half a second in: a film or a clip often starts on a black or a still first frame.
                  <video src={`${item.previewUrl}#t=0.5`} muted playsInline preload="metadata" aria-hidden="true" />
                )}
                <span className={styles.recentName}>{name}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link className={styles.recentAll} href="/history">
            {t('historySeeAll')}
          </Link>
        </li>
      </ul>
    </section>
  );
}
