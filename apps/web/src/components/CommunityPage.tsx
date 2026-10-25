'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import { communityHref, type CommunityEntry } from '@/lib/community';
import { useMotionPaused } from '@/lib/use-motion';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './history.module.css';
import own from './community.module.css';

type Filter = 'all' | 'mine' | 'example';
const FILTERS: [Filter, 'communityFilterAll' | 'communityFilterMine' | 'communityFilterExamples'][] = [
  ['all', 'communityFilterAll'],
  ['mine', 'communityFilterMine'],
  ['example', 'communityFilterExamples'],
];

/** A clip plays while the pointer is on its card, never on its own; a photo is a picture. */
function EntryMedia({ entry, paused }: { entry: CommunityEntry; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  if (!entry.previewUrl) return <div className={`${styles.media} ${own.noMedia}`} aria-hidden="true" />;
  if (entry.kind === 'photo') {
    // eslint-disable-next-line @next/next/no-img-element -- a local media URL
    return <img className={styles.media} src={entry.previewUrl} alt="" loading="lazy" />;
  }
  return (
    <video
      ref={video}
      className={styles.media}
      src={entry.previewUrl}
      poster={entry.posterUrl}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      onMouseEnter={() => {
        if (!paused) video.current?.play().catch(() => undefined);
      }}
      onMouseLeave={() => video.current?.pause()}
    />
  );
}

function EntryCard({ entry, paused, onRemove }: { entry: CommunityEntry; paused: boolean; onRemove: () => void }) {
  const { t } = useI18n();
  const mine = entry.source !== 'example';
  return (
    <li className={styles.card}>
      <EntryMedia entry={entry} paused={paused} />
      <div className={styles.cardText}>
        <p className={styles.cardName}>{entry.title}</p>
        <p className={styles.cardMeta}>
          {/* What made it, unless the title already says it (an example is titled by its move or effect). */}
          {[entry.author && t('communityBy', { name: entry.author }), entry.name !== entry.title && entry.name, entry.source === 'imported' && t('communityImported')]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className={styles.cardActions}>
        <Link className={`${styles.action} ${own.remix}`} href={communityHref(entry)}>
          {t('communityRemix')}
        </Link>
        {mine && !IS_SHOWCASE && (
          <>
            <a className={styles.action} href={`/api/community/${encodeURIComponent(entry.id)}/share`} download>
              {t('communityShareFile')}
            </a>
            <button
              type="button"
              className={styles.actionGhost}
              onClick={() => {
                if (window.confirm(t('communityRemoveConfirm', { title: entry.title }))) onRemove();
              }}
            >
              {t('communityRemove')}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** The community gallery: creations with their settings, remixed in one click; share files in and out. */
export function CommunityPage() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<CommunityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [importState, setImportState] = useState<'idle' | 'busy' | 'failed' | 'done'>('idle');
  const [paused] = useMotionPaused();

  useEffect(() => {
    let alive = true;
    apiFetch('/api/community')
      .then((res) => jsonOrThrow<CommunityEntry[]>(res))
      .then((list) => alive && setEntries(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const importShared = async (file: File | undefined) => {
    if (!file) return;
    setImportState('busy');
    try {
      const shared = JSON.parse(await file.text()) as unknown;
      const res = await apiFetch('/api/community/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shared) });
      const entry = await jsonOrThrow<CommunityEntry>(res);
      setEntries((current) => [entry, ...(current ?? [])]);
      setFilter('all');
      setImportState('done');
    } catch {
      setImportState('failed');
    }
  };

  const remove = async (id: string) => {
    const res = await apiFetch(`/api/community/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setEntries((current) => (current ?? []).filter((entry) => entry.id !== id));
  };

  const shown = (entries ?? []).filter((entry) => filter === 'all' || (filter === 'example' ? entry.source === 'example' : entry.source !== 'example'));
  const mineCount = (entries ?? []).filter((entry) => entry.source !== 'example').length;

  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className={styles.page}>
        <div className={own.intro}>
          <h1 className={styles.title}>{t('communityTitle')}</h1>
          <p className={own.lead}>{IS_SHOWCASE ? t('communityLeadShowcase') : t('communityLead')}</p>
        </div>
        {!IS_SHOWCASE && (
          <div className={own.importRow}>
            <input
              id="share-input"
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              disabled={importState === 'busy'}
              onChange={(event) => {
                void importShared(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <label htmlFor="share-input" className={styles.action} aria-disabled={importState === 'busy' || undefined}>
              {t('communityImport')}
            </label>
            <p className={own.hint} role="status">
              {importState === 'failed' ? t('communityImportFailed') : importState === 'done' ? t('communityImportDone') : t('communityImportHint')}
            </p>
          </div>
        )}
        {entries && entries.length > 0 && (
          <div className={styles.filters} role="group" aria-label={t('communityTitle')}>
            {FILTERS.filter(([value]) => !IS_SHOWCASE || value !== 'mine').map(([value, key]) => (
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
        {entries && filter === 'mine' && mineCount === 0 && (
          <div className={styles.empty}>
            <p>{t('communityMineEmpty')}</p>
            <Link className={styles.action} href="/history">
              {t('communityToHistory')}
            </Link>
          </div>
        )}
        {shown.length > 0 && (
          <ul className={styles.grid}>
            {shown.map((entry) => (
              <EntryCard key={entry.id} entry={entry} paused={paused} onRemove={() => void remove(entry.id)} />
            ))}
          </ul>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
