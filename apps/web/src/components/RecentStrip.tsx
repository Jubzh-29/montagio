'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import type { HistoryItem } from '@/lib/api-types';
import { repriseHref } from '@/lib/reprise';
import styles from './history.module.css';

const SHOWN = 5;

/**
 * Under the result: the last creations, each a way back to it, and the whole history.
 * Out of reach (inert) while a render runs: a Reuse would replace it.
 */
export function RecentStrip({ items, inert = false }: { items: HistoryItem[]; inert?: boolean }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title" inert={inert} data-testid="recent-strip">
      <h2 id="recent-title" className={styles.recentTitle}>
        {t('historyRecent')}
      </h2>
      <ul className={styles.recentList}>
        {items.slice(0, SHOWN).map((item) => (
          <li key={item.key}>
            <Link className={styles.recentItem} href={repriseHref(item)} aria-label={`${t('historyReuse')}: ${item.name}`}>
              {item.kind === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local media URL
                <img src={item.previewUrl} alt="" loading="lazy" />
              ) : (
                <video src={item.previewUrl} muted playsInline preload="metadata" aria-hidden="true" />
              )}
            </Link>
          </li>
        ))}
        <li>
          <Link className={styles.recentAll} href="/history">
            {t('historySeeAll')}
          </Link>
        </li>
      </ul>
    </section>
  );
}
