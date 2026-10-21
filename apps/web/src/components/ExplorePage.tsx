'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { ExtensionsInfo, PresetSummary } from '@/lib/api-types';
import { exploreTools, featuredCards, type ExploreCard } from '@/lib/explore';
import { useExtensions } from '@/lib/use-extensions';
import { useMotionPaused } from '@/lib/use-motion';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './explore.module.css';

/** A looping preview that follows the page's Pause toggle (WCAG 2.2.2). */
function Loop({ src, paused }: { src: string; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else element.play().catch(() => undefined);
  }, [paused, src]);
  return <video ref={video} className={styles.video} src={src} loop muted playsInline preload="metadata" aria-hidden="true" />;
}

function Card({ card, paused, big }: { card: ExploreCard; paused: boolean; big?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href={card.href} className={big ? styles.feature : styles.tool} data-media={card.previewUrl ? 'video' : 'icon'}>
      <span className={styles.media}>
        {card.previewUrl ? (
          <Loop src={card.previewUrl} paused={paused} />
        ) : (
          <span className={styles.icon} aria-hidden="true">
            {card.icon}
          </span>
        )}
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardName}>{t(card.name)}</span>
        <span className={styles.cardDescription}>{t(card.description)}</span>
      </span>
    </Link>
  );
}

/** The home of the app: what Montagio makes, as clips, and a door to every tool. */
export function ExplorePage() {
  const { t } = useI18n();
  const info: ExtensionsInfo | null = useExtensions();
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [paused, setPaused] = useMotionPaused();

  useEffect(() => {
    let alive = true;
    apiFetch('/api/presets')
      .then((res) => jsonOrThrow<PresetSummary[]>(res))
      .then((list) => alive && setPresets(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const featured = featuredCards(presets, info);
  const tools = exploreTools(presets, info);
  return (
    <>
      <Header current="explore" />
      <main className={styles.page}>
        <section className={styles.hero} aria-labelledby="explore-title">
          <h1 id="explore-title" className={styles.title}>
            {t('exploreTitle')}
          </h1>
          <p className={styles.lead}>{t('exploreLead')}</p>
          <div className={styles.actions}>
            <Link href="/?tab=effects" className={styles.primary}>
              {t('exploreStart')}
            </Link>
            <Link href="/open-stack" className={styles.secondary}>
              {t('exploreOpenStack')}
            </Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="explore-featured">
          <div className={styles.sectionHead}>
            <h2 id="explore-featured" className={styles.sectionTitle}>
              {t('exploreFeatured')}
            </h2>
            <button type="button" className={styles.toolButton} onClick={() => setPaused(!paused)}>
              {paused ? t('motionPlay') : t('motionPause')}
            </button>
          </div>
          <div className={styles.featured}>
            {featured.map((card) => (
              <Card key={card.id} card={card} paused={paused} big />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="explore-tools">
          <h2 id="explore-tools" className={styles.sectionTitle}>
            {t('exploreTools')}
          </h2>
          <div className={styles.tools}>
            {tools.map((card) => (
              <Card key={card.id} card={card} paused={paused} />
            ))}
          </div>
        </section>

        <section className={styles.stack}>
          <p className={styles.stackText}>{t('exploreStack')}</p>
          <Link href="/open-stack" className={styles.secondary}>
            {t('exploreStackLink')}
          </Link>
        </section>
      </main>
      <ShowcaseFooter />
    </>
  );
}
