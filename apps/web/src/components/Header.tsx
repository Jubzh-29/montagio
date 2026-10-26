'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useI18n, type Lang } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { OpenStackReport } from '@/lib/api-types';
import { tabHref, visibleTabs, type Tab } from '@/lib/tabs';
import { useExtensions } from '@/lib/use-extensions';
import { BrandMark, Wordmark } from './Brand';
import styles from './header.module.css';

function OpenStackBadge() {
  const { t } = useI18n();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/open-stack')
      .then((res) => jsonOrThrow<OpenStackReport>(res))
      .then((report) => alive && setOk(report.ok))
      .catch(() => alive && setOk(false));
    return () => {
      alive = false;
    };
  }, []);

  const label = ok === null ? t('badgeChecking') : ok ? t('badge') : t('badgeFailed');
  return (
    <Link href="/open-stack" className={styles.badge} data-state={ok === null ? 'checking' : ok ? 'ok' : 'failed'}>
      <span className={styles.badgeMark} aria-hidden="true" />
      <span className={styles.badgeLong}>{label}</span>
      {ok && <span className={styles.badgeShort}>{t('badgeShort')}</span>}
    </Link>
  );
}

function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const langs: Lang[] = ['en', 'fr'];
  return (
    <div className={styles.langs} role="group" aria-label={t('language')}>
      {langs.map((code) => (
        <button
          key={code}
          type="button"
          className={styles.lang}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const TAB_LABELS = { effects: 'tabEffects', camera: 'tabCamera', film: 'tabFilm', avatar: 'tabAvatar', motion: 'tabMotion' } as const;

/**
 * Whether a row that scrolls sideways has more out of view, before and after: on a phone the
 * tabs fade out on the side where there are more. The observer reports once when it starts.
 */
function useMoreOutOfView(ref: RefObject<HTMLElement | null>, count: number): { before: boolean; after: boolean } {
  const [more, setMore] = useState({ before: false, after: false });
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () =>
      setMore({ before: row.scrollLeft > 1, after: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
    row.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, count]);
  return more;
}

/** The creation tabs, as links: the Studio reads the tab from the URL. */
function Tabs({ current }: { current?: Tab | 'history' | 'explore' | 'characters' | 'ads' | 'examples' }) {
  const { t } = useI18n();
  const tabs = visibleTabs(useExtensions());
  const row = useRef<HTMLElement>(null);
  const more = useMoreOutOfView(row, tabs.length);
  // On a phone the current tab may be past the edge: bring it into the row's view.
  useEffect(() => {
    const currentTab = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (currentTab && row.current) row.current.scrollLeft = Math.max(0, currentTab.offsetLeft - row.current.offsetLeft - 16);
  }, [current, tabs.length]);
  return (
    <nav
      ref={row}
      className={styles.tabs}
      aria-label={t('tabsLabel')}
      data-more-before={more.before || undefined}
      data-more-after={more.after || undefined}
    >
      <Link href="/explore" className={styles.tab} aria-current={current === 'explore' ? 'page' : undefined}>
        {t('tabExplore')}
      </Link>
      {/* Characters need the local app (text to image, the photo edit): the showcase has neither. */}
      {!IS_SHOWCASE && (
        <Link href="/characters" className={styles.tab} aria-current={current === 'characters' ? 'page' : undefined}>
          {t('tabCharacters')}
        </Link>
      )}
      {!IS_SHOWCASE && (
        <Link href="/ads" className={styles.tab} aria-current={current === 'ads' ? 'page' : undefined}>
          {t('tabAds')}
        </Link>
      )}
      {tabs.map((tab) => (
        <Link key={tab} href={tabHref(tab)} className={styles.tab} aria-current={current === tab ? 'page' : undefined}>
          {t(TAB_LABELS[tab])}
        </Link>
      ))}
      {/* The functions the showcase cannot run, shown by the clips Montagio rendered for them. */}
      {IS_SHOWCASE && (
        <Link href="/examples" className={styles.tab} aria-current={current === 'examples' ? 'page' : undefined}>
          {t('tabExamples')}
        </Link>
      )}
      <Link href="/history" className={styles.tab} aria-current={current === 'history' ? 'page' : undefined}>
        {t('tabHistory')}
      </Link>
    </nav>
  );
}

export function Header({ recording = false, current }: { recording?: boolean; current?: Tab | 'history' | 'explore' | 'characters' | 'ads' | 'examples' }) {
  const { t } = useI18n();
  return (
    <header className={styles.header}>
      {/* First in the tab order: past the header's ten stops, to the page itself. */}
      <a className={styles.skip} href="#content">
        {t('skipToContent')}
      </a>
      <Link href="/explore" className={styles.brand}>
        <BrandMark recording={recording} className={styles.mark} />
        <Wordmark className={styles.wordmark} />
        <span className="visually-hidden">{t('appName')}</span>
        <span className={styles.tagline}>{t('tagline')}</span>
      </Link>
      <Tabs current={current} />
      <div className={styles.tools}>
        <OpenStackBadge />
        <LanguageToggle />
      </div>
    </header>
  );
}
