'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { HistoryItem } from '@/lib/api-types';
import { historyFilter, historyName, historySubject, repriseHref, type HistoryFilter } from '@/lib/reprise';
import { useMotionPaused } from '@/lib/use-motion';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './history.module.css';

const KIND_KEYS = { photo: 'historyKindPhoto', clip: 'historyKindClip', film: 'historyKindFilm' } as const;
const FILTERS = [
  ['all', 'historyFilterAll'],
  ['photo', 'historyFilterPhotos'],
  ['clip', 'historyFilterClips'],
  ['film', 'historyFilterFilms'],
] as const;

/** A clip or a film plays while the pointer or the focus is on its card, never on its own. */
function HistoryMedia({ item, paused }: { item: HistoryItem; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  if (item.kind === 'photo') {
    // eslint-disable-next-line @next/next/no-img-element -- a local media URL
    return <img className={styles.media} src={item.previewUrl} alt="" loading="lazy" />;
  }
  const play = () => {
    if (!paused) video.current?.play().catch(() => undefined);
  };
  const stop = () => video.current?.pause();
  return (
    <video
      ref={video}
      className={styles.media}
      src={item.previewUrl}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      onMouseEnter={play}
      onMouseLeave={stop}
    />
  );
}

export function HistoryCard({ item, paused }: { item: HistoryItem; paused: boolean }) {
  const { t, lang } = useI18n();
  const date = new Date(item.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const extension = item.kind === 'photo' ? 'png' : 'mp4';
  const subject = historySubject(item);
  const name = historyName(item, lang);
  const kindAndName = name === item.modelName ? t(KIND_KEYS[item.kind]) : `${t(KIND_KEYS[item.kind])} · ${name}`;
  return (
    <li className={styles.card}>
      <HistoryMedia item={item} paused={paused} />
      <div className={styles.cardText}>
        {/* Titled by what was asked, which tells two takes apart; what made it goes under. */}
        <p className={styles.cardName}>{subject ?? kindAndName}</p>
        <p className={styles.cardMeta}>
          {subject && `${kindAndName} · `}
          {item.modelName !== name && `${item.modelName} · `}
          <time dateTime={item.createdAt}>{date}</time>
        </p>
      </div>
      <div className={styles.cardActions}>
        <a className={styles.action} href={item.downloadUrl} download={`montagio-${item.key.replace(':', '-')}.${extension}`}>
          {t('historyDownload')}
        </a>
        <Link className={styles.action} href={repriseHref(item)}>
          {t('historyReuse')}
        </Link>
      </div>
    </li>
  );
}

/** Everything made here (in the showcase: during this visit), newest first. */
export function HistoryPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [paused] = useMotionPaused();

  useEffect(() => {
    let alive = true;
    apiFetch('/api/history')
      .then((res) => jsonOrThrow<HistoryItem[]>(res))
      .then((list) => alive && setItems(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const shown = items ? historyFilter(items, filter) : [];
  return (
    <>
      <Header current="history" />
      <main id="content" tabIndex={-1} className={styles.page}>
        <h1 className={styles.title}>{t('historyTitle')}</h1>
        {IS_SHOWCASE && <p className={styles.note}>{t('historyShowcaseNote')}</p>}
        {items && items.length > 0 && (
          <div className={styles.filters} role="group" aria-label={t('historyTitle')}>
            {FILTERS.map(([value, key]) => (
              <button key={value} type="button" className={styles.filter} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {failed && (
          <p className={styles.note} role="alert">
            {t('errorGeneric')}
          </p>
        )}
        {items && items.length === 0 && (
          <div className={styles.empty}>
            <p>{t('historyEmpty')}</p>
            <Link className={styles.action} href="/">
              {t('historyBackToStudio')}
            </Link>
          </div>
        )}
        {shown.length > 0 && (
          <ul className={styles.grid}>
            {shown.map((item) => (
              <HistoryCard key={item.key} item={item} paused={paused} />
            ))}
          </ul>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
