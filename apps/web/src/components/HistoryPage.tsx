'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { HistoryItem } from '@/lib/api-types';
import { COMMUNITY_AUTHOR_MAX, COMMUNITY_TITLE_MAX } from '@/lib/community';
import { canReproduce, historyFilter, historyName, historySubject, repriseHref, type HistoryFilter } from '@/lib/reprise';
import { refusalMessageKey } from '@/lib/refusals';
import { useMotionPaused } from '@/lib/use-motion';
import { Header } from './Header';
import { PurgeDataControl } from './PurgeDataControl';
import { RecipePanel } from './RecipePanel';
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

const AUTHOR_KEY = 'montagio-author';

/** The name the visitor signed with last time, on this browser only. */
function rememberedAuthor(): string {
  try {
    return window.localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Publish a creation to the community gallery: a title, a name if you like, its settings with it. */
function PublishForm({ item, defaultTitle, onClose }: { item: HistoryItem; defaultTitle: string; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultTitle.slice(0, COMMUNITY_TITLE_MAX));
  const [author, setAuthor] = useState(rememberedAuthor);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | { refusal: string }>('idle');
  const publish = async () => {
    if (!title.trim() || state === 'saving') return;
    setState('saving');
    try {
      window.localStorage.setItem(AUTHOR_KEY, author.trim());
    } catch {
      // The name is a convenience: without storage it is simply asked again.
    }
    const res = await apiFetch('/api/community', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ historyKey: item.key, title: title.trim(), ...(author.trim() ? { author: author.trim() } : {}) }),
    }).catch(() => null);
    if (res?.ok) return setState('done');
    const answer = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setState({ refusal: answer.error ?? 'error' });
  };
  const id = item.key.replace(':', '-');
  if (state === 'done') {
    return (
      <p className={styles.published} role="status">
        {t('communityPublished')}{' '}
        <Link className={styles.inlineLink} href="/community">
          {t('communityOpen')}
        </Link>
      </p>
    );
  }
  return (
    <form
      className={styles.publish}
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
    >
      <label htmlFor={`publish-title-${id}`}>{t('communityTitleLabel')}</label>
      <input id={`publish-title-${id}`} type="text" maxLength={COMMUNITY_TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} />
      <label htmlFor={`publish-author-${id}`}>{t('communityAuthorLabel')}</label>
      <input
        id={`publish-author-${id}`}
        type="text"
        maxLength={COMMUNITY_AUTHOR_MAX}
        placeholder={t('communityAuthorPlaceholder')}
        value={author}
        onChange={(event) => setAuthor(event.target.value)}
      />
      <p className={styles.publishNote}>{t('communityPublishNote')}</p>
      {typeof state === 'object' && (
        <p className={styles.publishError} role="alert">
          {t(refusalMessageKey(state.refusal))}
        </p>
      )}
      <div className={styles.cardActions}>
        <button type="submit" className={styles.action} disabled={!title.trim() || state === 'saving'}>
          {t('communityPublish')}
        </button>
        <button type="button" className={styles.actionGhost} onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

export function HistoryCard({ item, paused }: { item: HistoryItem; paused: boolean }) {
  const [publishing, setPublishing] = useState(false);
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
      {item.recipeUrl && (
        <div className={styles.cardRecipe}>
          {/* Reproduce sits with Reuse in the card's actions. */}
          <RecipePanel url={item.recipeUrl} />
        </div>
      )}
      <div className={styles.cardActions}>
        <a className={styles.action} href={item.downloadUrl} download={`montagio-${item.key.replace(':', '-')}.${extension}`}>
          {t('historyDownload')}
        </a>
        <Link className={styles.action} href={repriseHref(item)}>
          {t('historyReuse')}
        </Link>
        {canReproduce(item) && (
          <Link className={styles.action} href={repriseHref(item, { reproduce: true })} data-testid="history-reproduce">
            {t('recipeReproduce')}
          </Link>
        )}
        {!IS_SHOWCASE && !publishing && (
          <button type="button" className={styles.action} onClick={() => setPublishing(true)}>
            {t('communityPublish')}
          </button>
        )}
      </div>
      {publishing && <PublishForm item={item} defaultTitle={subject ?? name} onClose={() => setPublishing(false)} />}
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
        {!IS_SHOWCASE && items && items.length > 0 && <p className={styles.note}>{t('exportRecipeNotice')}</p>}
        {!IS_SHOWCASE && <PurgeDataControl onPurged={() => setItems([])} />}
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
