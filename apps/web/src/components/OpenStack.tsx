'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { OpenStackReport, StackFunction } from '@/lib/api-types';
import { stackAnchor } from '@/lib/open-stack';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './openstack.module.css';

/** The page's sections, in the report's order: what each group of models makes in the Studio. */
const FUNCTION_TITLES: Record<StackFunction, MessageKey> = {
  camera: 'stackCamera',
  effects: 'stackEffects',
  transitions: 'stackTransitions',
  photo: 'stackPhoto',
  avatar: 'stackAvatar',
  music: 'stackMusic',
  hd: 'stackHd',
  motion: 'stackMotion',
};

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The row a caption links to (#model-<id>), followed as the hash changes; none on the server. */
function useTargetModel(): string | null {
  return useSyncExternalStore(
    subscribeToHash,
    () => decodeURIComponent(window.location.hash.replace(/^#/, '')) || null,
    () => null,
  );
}

export function OpenStack() {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<OpenStackReport | null>(null);
  const [failed, setFailed] = useState(false);
  const target = useTargetModel();
  const targetRow = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    apiFetch('/api/open-stack')
      .then((res) => jsonOrThrow<OpenStackReport>(res))
      .then(setReport)
      .catch(() => setFailed(true));
  }, []);

  // The rows arrive after the page: the browser could not scroll to the linked one, so do it here.
  useEffect(() => {
    const row = targetRow.current;
    if (!row) return;
    // From its top, under the header (the page's scroll-padding): a model with many weights is taller than a phone.
    row.scrollIntoView({ block: 'start' });
    row.focus({ preventScroll: true });
  }, [report, target]);

  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const gigabytes = (bytes: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(bytes / 1e9);
  // Under 0.1 GB a file reads in MB: "0.0 GB" would look like an empty file on the proof page.
  const weightSize = (bytes: number) =>
    bytes >= 1e8
      ? t('sizeGb', { size: gigabytes(bytes) })
      : t('sizeMb', { size: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1e6) });
  const weights = report?.models.flatMap((model) => model.weights) ?? [];
  const files = new Map(weights.map((weight) => [weight.id, weight]));
  const totalBytes = [...files.values()].reduce((sum, weight) => sum + (weight.bytes ?? 0), 0);
  const groups = report ? (Object.keys(FUNCTION_TITLES) as StackFunction[]).filter((fn) => report.models.some((model) => model.function === fn)) : [];

  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className={styles.page}>
        <h1 className={styles.title}>{t('openStackTitle')}</h1>
        <p className={styles.intro}>{t('openStackIntro')}</p>
        {/* What the render path is built on, under the intro: the Comfy SDK run locally, and the node pack. */}
        <ul className={styles.platform} data-testid="open-stack-platform">
          <li>{t('openStackSdk')}</li>
          <li>{t('openStackNodePack')}</li>
        </ul>
        {report ? (
          <>
            <p className={styles.checked} data-state={report.ok ? 'ok' : 'failed'}>
              {report.ok ? t('badge') : t('badgeFailed')} · {t('verifiedAt', { date: new Date(report.checkedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
            </p>
            <p className={styles.summary}>
              {t('openStackSummary', { models: report.models.length, files: files.size, size: gigabytes(totalBytes) })}
            </p>
          </>
        ) : (
          <p className={styles.checked} data-state={failed ? 'failed' : 'checking'} role={failed ? 'alert' : undefined}>
            {failed ? t('openStackUnavailable') : t('badgeChecking')}
          </p>
        )}

        {groups.map((fn) => (
          <section key={fn} className={styles.group} aria-labelledby={`stack-${fn}`}>
            <h2 id={`stack-${fn}`} className={styles.subtitle}>
              {t(FUNCTION_TITLES[fn])}
            </h2>
            {/* On a phone the rows become blocks (CSS); the explicit roles keep them a table for screen readers. */}
            <table className={styles.table} role="table" aria-labelledby={`stack-${fn}`}>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">{t('modelCol')}</th>
                  <th scope="col" role="columnheader">{t('licenseCol')}</th>
                  <th scope="col" role="columnheader">{t('weightsCol')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {report!.models
                  .filter((model) => model.function === fn)
                  .map((model) => {
                    const targeted = target === stackAnchor(model.id);
                    return (
                      <tr
                        key={model.id}
                        id={stackAnchor(model.id)}
                        ref={targeted ? targetRow : undefined}
                        tabIndex={targeted ? -1 : undefined}
                        data-target={targeted || undefined}
                        data-testid="model-row"
                        role="row"
                        className={styles.row}
                      >
                        <th scope="row" role="rowheader">
                          <span className={styles.modelName}>{model.name}</span>
                          <span className={styles.modelId}>{model.id}</span>
                        </th>
                        <td role="cell" className={styles.license}>
                          {model.license}
                        </td>
                        <td role="cell">
                          <ul className={styles.weights}>
                            {model.weights.map((weight) => (
                              <li key={weight.id}>
                                {weight.source ? (
                                  <a className={styles.weightId} href={weight.source} title={t('weightSource', { url: weight.source })}>
                                    {weight.id}
                                  </a>
                                ) : (
                                  <span className={styles.weightId}>{weight.id}</span>
                                )}
                                <span className={styles.weightMeta}>
                                  <span>{weight.bytes !== undefined ? weightSize(weight.bytes) : ''}</span>
                                  <span>{weight.license}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
        ))}

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
