'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n, type Lang } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { OpenStackReport } from '@/lib/api-types';
import { tabHref, visibleTabs, type Tab } from '@/lib/tabs';
import { useExtensions } from '@/lib/use-extensions';
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

/** The creation tabs, as links: the Studio reads the tab from the URL. */
function Tabs({ current }: { current?: Tab | 'history' | 'explore' }) {
  const { t } = useI18n();
  const tabs = visibleTabs(useExtensions());
  return (
    <nav className={styles.tabs} aria-label={t('tabsLabel')}>
      <Link href="/explore" className={styles.tab} aria-current={current === 'explore' ? 'page' : undefined}>
        {t('tabExplore')}
      </Link>
      {tabs.map((tab) => (
        <Link key={tab} href={tabHref(tab)} className={styles.tab} aria-current={current === tab ? 'page' : undefined}>
          {t(TAB_LABELS[tab])}
        </Link>
      ))}
      <Link href="/history" className={styles.tab} aria-current={current === 'history' ? 'page' : undefined}>
        {t('tabHistory')}
      </Link>
    </nav>
  );
}

export function Header({ recording = false, current }: { recording?: boolean; current?: Tab | 'history' | 'explore' }) {
  const { t } = useI18n();
  return (
    <header className={styles.header}>
      <Link href="/explore" className={styles.brand}>
        <span className={styles.rec} data-recording={recording} aria-hidden="true" />
        <span className={styles.wordmark}>{t('appName')}</span>
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
