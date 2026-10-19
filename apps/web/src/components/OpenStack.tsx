'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { OpenStackReport } from '@/lib/api-types';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './openstack.module.css';

export function OpenStack() {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<OpenStackReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch('/api/open-stack')
      .then((res) => jsonOrThrow<OpenStackReport>(res))
      .then(setReport)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{t('openStackTitle')}</h1>
        <p className={styles.intro}>{t('openStackIntro')}</p>
        {report ? (
          <p className={styles.checked} data-state={report.ok ? 'ok' : 'failed'}>
            {report.ok ? t('badge') : t('badgeFailed')} ·{' '}
            {t('verifiedAt', { date: new Date(report.checkedAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') })}
          </p>
        ) : (
          <p className={styles.checked} data-state={failed ? 'failed' : 'checking'} role={failed ? 'alert' : undefined}>
            {failed ? t('openStackUnavailable') : t('badgeChecking')}
          </p>
        )}

        {/* On a phone the rows become blocks (CSS); the explicit roles keep them a table for screen readers. */}
        <table className={styles.table} role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">{t('modelCol')}</th>
              <th scope="col" role="columnheader">{t('licenseCol')}</th>
              <th scope="col" role="columnheader">{t('weightsCol')}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {report?.models.map((model) => (
              <tr key={model.id} data-testid="model-row" role="row">
                <th scope="row" role="rowheader" className={styles.mono}>
                  {model.id}
                </th>
                <td role="cell" className={styles.license}>{model.license}</td>
                <td role="cell">
                  <ul className={styles.weights}>
                    {model.weights.map((weight) => (
                      <li key={weight.id}>
                        <span className={styles.mono}>{weight.id}</span>
                        <span className={styles.weightLicense}>{weight.license}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {report && (
          <section className={styles.violations} aria-labelledby="violations-heading">
            <h2 id="violations-heading" className={styles.subtitle}>
              {t('violations')}
            </h2>
            {report.violations.length === 0 ? (
              <p className={styles.none}>{t('noViolations')}</p>
            ) : (
              <ul>
                {report.violations.map((violation, index) => (
                  <li key={index}>
                    <span className={styles.mono}>[{violation.rule}]</span> {violation.file}: {violation.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <Link href="/" className={styles.back}>
          ← {t('backToStudio')}
        </Link>
      </main>
      <ShowcaseFooter />
    </>
  );
}
