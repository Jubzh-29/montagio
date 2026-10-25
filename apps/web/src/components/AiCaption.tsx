'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { IS_SHOWCASE } from '@/lib/api';
import type { DemoKind } from '@/lib/api-types';
import { useExtensions } from '@/lib/use-extensions';
import { stackHref } from '@/lib/open-stack';
import styles from './studio.module.css';

/** The captions that name a model: each holds `{model}` and `{license}`; the HD one also `{hd}` and `{hdLicense}`. */
type CaptionText = 'aiCaption' | 'demoCaption' | 'showcaseCaption' | 'showcaseHdCaption' | 'hookEndFrame' | 'restyleFirstFrame';

type CaptionModel = { id?: string; name: string; license: string };

/**
 * Under every result: what made it, and that it is AI-generated (the AI Act's visible mention).
 * Each model's name leads to its line on the Open Stack page, where its weights and licences are:
 * the one that rendered the result, and the one that restored it to 1080p when there is one (`hd`).
 */
export function AiCaption({
  model,
  hd,
  text = 'aiCaption',
  testId = 'ai-caption',
  as: Tag = 'p',
  prefix,
  demoKind,
}: {
  /** Without an id (an unknown model), the name is plain text. */
  model: CaptionModel;
  hd?: CaptionModel;
  text?: CaptionText;
  testId?: string;
  /** A figure's caption, styled by its figure. */
  as?: 'p' | 'figcaption';
  prefix?: string;
  /** What a demo result is: the GPU render of the same sample photo, or the photo moved by FFmpeg. */
  demoKind?: DemoKind;
}) {
  const { t } = useI18n();
  // Without a GPU (the demo backend) no model made the result: the caption says what would make it.
  const demo = useExtensions()?.demo === true && !IS_SHOWCASE;
  const key =
    text !== 'aiCaption'
      ? text
      : demoKind === 'example'
        ? 'demoExampleCaption'
        : demoKind === 'moved'
          ? 'demoMovedCaption'
          : demo
            ? 'demoCaption'
            : text;
  const parts = t(key, { license: model.license, hdLicense: hd?.license ?? '' }).split(/(\{model\}|\{hd\})/);
  const name = (named: CaptionModel, index: number) =>
    named.id ? (
      <Link key={index} href={stackHref(named.id)} className={styles.captionLink}>
        {named.name}
      </Link>
    ) : (
      named.name
    );
  return (
    <Tag className={Tag === 'p' ? styles.caption : undefined} data-testid={testId}>
      {prefix}
      {parts.map((part, index) => (part === '{model}' ? name(model, index) : part === '{hd}' && hd ? name(hd, index) : part))}
    </Tag>
  );
}
