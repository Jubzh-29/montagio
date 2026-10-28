'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE } from '@/lib/api';
import type { ShareSummary } from '@/lib/api-types';
import type { RecipeSource } from '@/lib/recipe-url';
import { refusalMessageKey } from '@/lib/refusals';
import { shareCaption, type ShareKind } from '@/lib/share';
import captions from './captions.module.css';
import share from './share.module.css';
import styles from './studio.module.css';

const SHARE_POLL_MS = 1000;

/**
 * Under a finished result: a 9:16 for TikTok, Reels and Shorts, and a caption to paste with it. The server
 * renders the 9:16 (1080x1920, the AI mention and the recipe in the file), ending on a discreet "Made with
 * Montagio" card unless it is unticked; the caption is written here from what the result is, nothing is asked
 * of any service. The showcase has no server: it offers the 9:16 prepared with the clip, when there is one.
 */
export function SharePanel({
  source,
  id,
  kind,
  title,
  model,
  caption,
  showcaseVertical,
}: {
  source: RecipeSource;
  id: string;
  kind: ShareKind;
  /** What the result is called (a preset, an effect): the caption's first line names it. */
  title?: string;
  /** The model that made the result, named in the caption's AI mention; without it, the generic mention. */
  model?: { name: string; license: string };
  /** A caption the result already has (a trend remix's): offered instead of the one written here. */
  caption?: string;
  /** Showcase: the clip's 9:16 as prepared with it, without the end card. */
  showcaseVertical?: string;
}) {
  const { t } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [endCard, setEndCard] = useState(true);
  const [made, setMade] = useState<ShareSummary | null>(null);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Written in the page's language, and again in another one, until the user changes it.
  const proposed = caption?.trim() || shareCaption(t, { kind, ...(title ? { title } : {}), ...(model ? { model } : {}) });
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? proposed;
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // The 9:16 renders on the server: its state is polled until it ends.
  useEffect(() => {
    if (made?.state !== 'running') return;
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/share/${encodeURIComponent(made.id)}`).catch(() => null);
      if (res?.ok) setMade((await res.json()) as ShareSummary);
      else if (res?.status === 404) setMade({ ...made, state: 'failed', error: 'lost' });
      else setMade({ ...made });
    }, SHARE_POLL_MS);
    return () => clearTimeout(timer);
  }, [made]);

  const running = sending || made?.state === 'running';
  const done = made?.state === 'succeeded' && made.url && made.endCard === endCard ? made : null;
  const download = IS_SHOWCASE ? showcaseVertical : done?.url;

  const make = async () => {
    if (running) return;
    setSending(true);
    setRefusal(null);
    try {
      const res = await apiFetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, id, endCard }),
      });
      const body = (await res.json().catch(() => ({}))) as ShareSummary & { error?: string };
      if (res.ok) setMade(body);
      else setRefusal(body.error ?? 'errorGeneric');
    } catch {
      setRefusal('errorGeneric');
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard (an insecure origin, a refusal): the text is selected for a manual copy.
      field.current?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.panelSection}>
      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} data-testid="share-toggle">
          {t('share')}
        </button>
      </div>
      {open && (
        <div id={panelId} className={share.panel} data-testid="share-panel">
          <div className={share.text}>
            {!IS_SHOWCASE && (
              <label className={styles.consent}>
                <input type="checkbox" checked={endCard} disabled={running} onChange={(event) => setEndCard(event.target.checked)} data-testid="share-end-card" />
                <span>{t('shareEndCard')}</span>
              </label>
            )}
            <div className={styles.actions}>
              {!IS_SHOWCASE && !done && (
                <button type="button" className={styles.buttonSecondary} disabled={running} onClick={() => void make()} data-testid="share-make">
                  {running ? t('shareMaking') : t('shareMake')}
                </button>
              )}
              {download && (
                <a className={styles.buttonSecondary} href={download} download="montagio-9x16.mp4" data-testid="share-download">
                  {t('shareDownload')}
                </a>
              )}
            </div>
            {running && (
              <p className={styles.hint} role="status">
                {t('shareMaking')}
              </p>
            )}
            {(refusal || made?.state === 'failed') && (
              <p className={styles.photoError} role="alert">
                {refusal ? t(refusalMessageKey(refusal)) : t('shareFailed')}
              </p>
            )}
            {IS_SHOWCASE && <p className={styles.hint}>{t('shareShowcaseNote')}</p>}

            <label htmlFor={`${panelId}-caption`} className={styles.sectionTitle}>
              {t('shareCaptionLabel')}
            </label>
            <textarea
              ref={field}
              id={`${panelId}-caption`}
              className={styles.prompt}
              rows={5}
              value={text}
              onChange={(event) => setEdited(event.target.value)}
              data-testid="share-caption"
            />
            <div className={styles.actions}>
              <button type="button" className={styles.buttonSecondary} onClick={() => void copy()} data-testid="share-copy">
                {copied ? t('shareCopied') : t('shareCopy')}
              </button>
            </div>
            <p className={styles.hint}>{t('shareAiNote')}</p>
            {!IS_SHOWCASE && <p className={styles.hint}>{t('exportRecipeNotice')}</p>}
          </div>
          {download && (
            <figure className={`${captions.frame} ${share.frame}`}>
              <video className={captions.media} src={download} controls playsInline data-testid="share-result" />
              <span className={captions.mark} data-corner="tl" aria-hidden="true" />
              <span className={captions.mark} data-corner="br" aria-hidden="true" />
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
