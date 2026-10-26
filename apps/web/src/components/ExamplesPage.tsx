'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { IS_SHOWCASE } from '@/lib/api';
import { FeatureExamples, useFeatureExamples } from './FeatureExamples';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import page from './ads.module.css';
import explore from './explore.module.css';
import studio from './studio.module.css';

/**
 * Every function of the showcase that cannot run without a GPU, shown by a clip Montagio rendered:
 * the trend remix, Restyle, the object swap, the motion transfer, the avatar, its translation and its
 * captions. In the app on a machine, the functions themselves are one click away instead.
 */
export function ExamplesPage() {
  const { t } = useI18n();
  const examples = useFeatureExamples();
  return (
    <>
      <Header current="examples" />
      <main id="content" tabIndex={-1} className={page.page}>
        <div className={page.intro}>
          <h1 className={page.title}>{t('examplesTitle')}</h1>
          <p className={page.lead}>{t(IS_SHOWCASE ? 'examplesLead' : 'examplesLocal')}</p>
          {!IS_SHOWCASE && (
            <p>
              <Link href="/explore" className={explore.secondary}>
                {t('tabExplore')}
              </Link>
            </p>
          )}
        </div>
        {IS_SHOWCASE && examples !== null && examples.length === 0 ? <p className={studio.hint}>{t('examplesNone')}</p> : <FeatureExamples examples={examples} />}
      </main>
      <ShowcaseFooter />
    </>
  );
}
