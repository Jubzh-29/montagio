'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { IS_SHOWCASE } from '@/lib/api';
import { useExtensions } from '@/lib/use-extensions';
import { stackHref } from '@/lib/open-stack';
import styles from './studio.module.css';

/** The captions that name a model: each holds `{model}` and `{license}`. */
type CaptionText = 'aiCaption' | 'demoCaption' | 'showcaseCaption' | 'hookEndFrame';

/**
 * Under every result: what made it, and that it is AI-generated (the AI Act's visible mention).
 * The model's name leads to its line on the Open Stack page, where its weights and licences are.
 */
export function AiCaption({
  model,
  text = 'aiCaption',
  testId = 'ai-caption',
  as: Tag = 'p',
  prefix,
}: {
  /** Without an id (an unknown model), the name is plain text. */
  model: { id?: string; name: string; license: string };
  text?: CaptionText;
  testId?: string;
  /** A figure's caption, styled by its figure. */
  as?: 'p' | 'figcaption';
  prefix?: string;
}) {
  const { t } = useI18n();
  // Without a GPU (the demo backend) no model made the result: the caption says what would make it.
  const demo = useExtensions()?.demo === true && !IS_SHOWCASE;
  const [before, after = ''] = t(demo && text === 'aiCaption' ? 'demoCaption' : text, { license: model.license }).split('{model}');
  return (
    <Tag className={Tag === 'p' ? styles.caption : undefined} data-testid={testId}>
      {prefix}
      {before}
      {model.id ? (
        <Link href={stackHref(model.id)} className={styles.captionLink}>
          {model.name}
        </Link>
      ) : (
        model.name
      )}
      {after}
    </Tag>
  );
}
