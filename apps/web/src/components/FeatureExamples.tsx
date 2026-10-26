'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { FeatureExample } from '@/lib/api-types';
import { CHARACTER_BANK } from '@/lib/character-bank';
import { stackHref } from '@/lib/open-stack';
import styles from './examples.module.css';

export type FeatureKind = FeatureExample['feature'];

/** The order the examples page shows the functions in: what the jury tries first. */
export const FEATURE_ORDER: readonly FeatureKind[] = ['remix', 'restyle', 'swap', 'motion', 'avatar', 'translate', 'captions'];

const GROUP_TITLES: Record<FeatureKind, MessageKey> = {
  avatar: 'examplesAvatar',
  translate: 'examplesTranslate',
  captions: 'examplesCaptions',
  motion: 'examplesMotion',
  restyle: 'examplesRestyle',
  swap: 'examplesSwap',
  remix: 'examplesRemix',
};
const GROUP_LEADS: Record<FeatureKind, MessageKey> = {
  avatar: 'examplesAvatarLead',
  translate: 'examplesTranslateLead',
  captions: 'examplesCaptionsLead',
  motion: 'examplesMotionLead',
  restyle: 'examplesRestyleLead',
  swap: 'examplesSwapLead',
  remix: 'examplesRemixLead',
};
const INPUT_LABELS: Record<FeatureExample['inputs'][number]['role'], MessageKey> = {
  photo: 'examplesInputPhoto',
  clip: 'examplesInputClip',
  frame: 'examplesInputFrame',
};

/** The feature examples of the showcase, once (the router answers from data.json); an empty list outside it. */
export function useFeatureExamples(): FeatureExample[] | null {
  const [examples, setExamples] = useState<FeatureExample[] | null>(IS_SHOWCASE ? null : []);
  useEffect(() => {
    if (!IS_SHOWCASE) return;
    let alive = true;
    apiFetch('/api/showcase/features')
      .then((res) => jsonOrThrow<FeatureExample[]>(res))
      .then((list) => alive && setExamples(list))
      .catch(() => alive && setExamples([]));
    return () => {
      alive = false;
    };
  }, []);
  return examples;
}

/** A language code by its own name in the interface's language ("zh" → "Chinese"). */
function languageName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Media({ url, poster, kind, label, sound }: { url: string; poster?: string; kind: 'image' | 'video'; label: string; sound?: boolean }) {
  return kind === 'image' ? (
    // eslint-disable-next-line @next/next/no-img-element -- a static file of the showcase, at its own size
    <img className={styles.media} src={url} alt={label} loading="lazy" />
  ) : (
    <video className={styles.media} src={url} poster={poster} controls playsInline preload="metadata" muted={!sound} aria-label={label} />
  );
}

/** One example: what it started from, what Montagio made, the models of each step and their workflows. */
function ExampleCard({ example, from }: { example: FeatureExample; from: FeatureExample | undefined }) {
  const { t, lang } = useI18n();
  const face = example.face ? CHARACTER_BANK.find((candidate) => candidate.id === example.face) : undefined;
  const sources = [
    ...(from ? [{ key: 'from', label: t('examplesInputSpeech'), node: <Media url={from.url} poster={from.poster} kind="video" label={t('examplesInputSpeech')} sound /> }] : []),
    ...example.inputs.map((input) => ({
      key: input.url,
      label: input.role === 'photo' && face ? t('examplesInputFace', { name: face.name }) : t(INPUT_LABELS[input.role]),
      node: <Media url={input.url} kind={input.role === 'clip' ? 'video' : 'image'} label={t(INPUT_LABELS[input.role])} />,
    })),
  ];
  const details: string[] = [];
  if (example.text) {
    const key: MessageKey | null =
      example.feature === 'avatar' || example.feature === 'captions'
        ? 'examplesSays'
        : example.feature === 'restyle'
          ? 'examplesLook'
          : example.feature === 'swap'
            ? 'examplesObject'
            : example.feature === 'remix'
              ? 'examplesCharacter'
              : null;
    if (key) details.push(t(key, { text: example.text }));
  }
  if (example.language && (example.feature === 'translate' || example.feature === 'captions')) details.push(t('examplesLanguage', { language: languageName(example.language, lang) }));
  if (example.style) details.push(t('examplesStyle', { style: example.style }));
  return (
    <article className={styles.card} data-feature={example.feature} data-testid={`example-${example.id}`}>
      <div className={styles.pair} data-aspect={example.aspect}>
        {sources.length > 0 && (
          <div className={styles.sources}>
            {sources.map((source) => (
              <figure key={source.key} className={styles.figure}>
                {source.node}
                <figcaption className={styles.caption}>{source.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <figure className={styles.result}>
          <Media url={example.url} poster={example.poster} kind="video" label={t('examplesResult')} sound={example.audio} />
          <figcaption className={styles.caption}>
            {t('examplesResult')}
            {example.hd && <span className={styles.badge}>{t('examplesHd', { fps: example.hd.fps })}</span>}
            <span className={styles.badge}>{t('examplesAi')}</span>
          </figcaption>
        </figure>
      </div>
      {details.length > 0 && (
        <ul className={styles.details}>
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {example.post && (
        <blockquote className={styles.post}>
          <p>{example.post.caption}</p>
          {example.post.hashtags.length > 0 && <p className={styles.hashtags}>{example.post.hashtags.map((tag) => `#${tag}`).join(' ')}</p>}
          <footer className={styles.caption}>{t('examplesPost')}</footer>
        </blockquote>
      )}
      <ol className={styles.steps} aria-label={t('examplesSteps')}>
        {example.steps.map((step, index) => (
          <li key={`${step.model.id}-${index}`} className={styles.step}>
            <Link href={stackHref(step.model.id)} className={styles.model}>
              {step.model.name}
            </Link>
            <span className={styles.license}>{step.model.license}</span>
            <a className={styles.workflow} href={step.workflowUrl} download={`montagio-${example.id}-${index + 1}.json`}>
              {t('examplesWorkflow')}
            </a>
          </li>
        ))}
        {example.hd && (
          <li className={styles.step}>
            <Link href={stackHref(example.hd.id)} className={styles.model}>
              {example.hd.name}
            </Link>
            <span className={styles.license}>{example.hd.license}</span>
            <a className={styles.workflow} href={example.hd.workflowUrl} download={`montagio-${example.id}-hd.json`}>
              {t('examplesWorkflow')}
            </a>
          </li>
        )}
      </ol>
    </article>
  );
}

/**
 * The feature examples of the showcase, grouped by function: each one a clip Montagio rendered on a GPU
 * from the showcase's own photos and clips, beside what it started from, with the open model of each
 * step and the workflow it ran. `kinds` keeps some functions only (the Remix page shows its own).
 */
export function FeatureExamples({ kinds = FEATURE_ORDER, examples }: { kinds?: readonly FeatureKind[]; examples: FeatureExample[] | null }) {
  const { t } = useI18n();
  if (examples === null) return <p className={styles.loading}>{t('examplesLoading')}</p>;
  const groups = kinds.map((kind) => ({ kind, items: examples.filter((example) => example.feature === kind) })).filter((group) => group.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className={styles.groups}>
      {groups.map(({ kind, items }) => (
        <section key={kind} className={styles.group} aria-labelledby={`examples-${kind}`}>
          <div className={styles.groupHead}>
            <h2 id={`examples-${kind}`} className={styles.groupTitle}>
              {t(GROUP_TITLES[kind])}
            </h2>
            <p className={styles.groupLead}>{t(GROUP_LEADS[kind])}</p>
          </div>
          <div className={styles.cards}>
            {items.map((example) => (
              <ExampleCard key={example.id} example={example} from={example.from ? examples.find((candidate) => candidate.id === example.from) : undefined} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
