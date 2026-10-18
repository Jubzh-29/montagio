'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n, type Lang } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { OpenStackReport } from '@/lib/api-types';
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
  const { lang, setLang } = useI18n();
  const langs: Lang[] = ['en', 'fr'];
  return (
    <div className={styles.langs} role="group" aria-label="Language">
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

export function Header({ recording = false }: { recording?: boolean }) {
  const { t } = useI18n();
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.rec} data-recording={recording} aria-hidden="true" />
        <span className={styles.wordmark}>{t('appName')}</span>
        <span className={styles.tagline}>{t('tagline')}</span>
      </Link>
      <div className={styles.tools}>
        <OpenStackBadge />
        <LanguageToggle />
      </div>
    </header>
  );
}
