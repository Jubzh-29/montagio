'use client';

import { useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDuration } from '@/lib/duration';
import type { ExtensionsInfo } from '@/lib/api-types';
import { needsConsent } from '@/lib/consent';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import type { UploadState } from './Monitor';
import { AiCaption } from './AiCaption';
import styles from './studio.module.css';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
const LOOKS = [
  ['', 'editLookNone'],
  ['infl8', 'editLookInfl8'],
  ['action', 'editLookAction'],
  ['angles', 'editLookAngles'],
] as const;
const TEXT_MAX = 500;

/** The photo the atelier hands back to the Studio. */
export type AtelierPhoto = { imageRef: string; url: string; personal: boolean; prompt?: string };

/**
 * The photo atelier, over the canvas: create the start photo from a text (Z-Image-Turbo),
 * or edit the current one with an instruction (Qwen-Image-Edit), then use the result.
 */
export function PhotoAtelier({
  kind,
  photo,
  estimates,
  onUse,
  onClose,
  licenseOf,
}: {
  kind: 't2i' | 'edit';
  photo: UploadState;
  estimates: ExtensionsInfo['estimates'];
  onUse: (photo: AtelierPhoto) => void;
  onClose: () => void;
  /** The license of a model of the catalogue, for the caption under the image. */
  licenseOf: (modelId: string) => string | undefined;
}) {
  const { t } = useI18n();
  const { job, refusal, busy, start, cancel } = useJob();
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>('16:9');
  const [look, setLook] = useState<string>('');
  const [consent, setConsent] = useState(false);
  // Another photo asks for consent again (state adjusted while rendering, when the photo changes).
  const photoKey = photo.status === 'ready' ? photo.imageRef : null;
  const [consentFor, setConsentFor] = useState(photoKey);
  if (consentFor !== photoKey) {
    setConsentFor(photoKey);
    setConsent(false);
  }
  // An edit shows the photo it started from, even when the visitor loads another one meanwhile.
  const [source, setSource] = useState<UploadState | null>(null);
  const before = job && source ? source : photo;
  const askConsent = kind === 'edit' && needsConsent(photo, 'edit');
  const done = job?.state === 'succeeded' && job.outputImageRef && job.outputUrl ? job : null;
  const canStart = text.trim().length > 0 && !busy && (kind === 't2i' || (photo.status === 'ready' && (!askConsent || consent)));
  // What a disabled button waits for, said under it: the photo first, then the text, then the consent.
  const waitingFor: MessageKey | null = busy
    ? null
    : kind === 'edit' && photo.status !== 'ready'
      ? 'editNeedsPhoto'
      : !text.trim()
        ? kind === 't2i'
          ? 't2iNeedsText'
          : 'editNeedsText'
        : kind === 'edit' && askConsent && !consent
          ? 'editNeedsConsent'
          : null;
  const percent = job ? Math.round(job.progress * 100) : 0;

  const run = () => {
    if (!canStart) return;
    if (kind === 't2i') void start('/api/images', { prompt: text.trim(), aspect });
    else if (photo.status === 'ready') {
      setSource(photo);
      void start('/api/edits', { imageRef: photo.imageRef, instruction: text.trim(), ...(look ? { look } : {}), ...(askConsent ? { consent } : {}) });
    }
  };

  const use = () => {
    if (!done) return;
    onUse({ imageRef: done.outputImageRef!, url: done.outputUrl!, personal: done.personal ?? true, ...(kind === 't2i' ? { prompt: text.trim() } : {}) });
  };

  const failed = job?.state === 'failed' || job?.state === 'canceled';
  return (
    <section className={styles.atelier} aria-labelledby="atelier-title">
      <div className={styles.atelierHead}>
        <h2 id="atelier-title" className={styles.atelierTitle}>
          {kind === 't2i' ? t('t2iTitle') : t('editTitle')}
        </h2>
        <button type="button" className={styles.buttonGhost} onClick={onClose}>
          {t('atelierClose')}
        </button>
      </div>

      <label htmlFor="atelier-text" className={styles.sectionTitle}>
        {kind === 't2i' ? t('t2iPrompt') : t('editInstruction')}
      </label>
      <textarea
        id="atelier-text"
        className={styles.prompt}
        rows={3}
        maxLength={TEXT_MAX}
        placeholder={kind === 't2i' ? t('t2iPlaceholder') : t('editPlaceholder')}
        value={text}
        disabled={busy}
        aria-describedby="atelier-count"
        onChange={(event) => setText(event.target.value)}
      />
      <p id="atelier-count" className={styles.counter}>
        {t('charCount', { n: text.length, max: TEXT_MAX })}
      </p>

      {kind === 't2i' ? (
        <>
        <p id="atelier-format" className={styles.sectionTitle}>
          {t('t2iFormat')}
        </p>
        <div className={styles.canvasViews} role="radiogroup" aria-labelledby="atelier-format">
          {ASPECTS.map((value) => (
            <button key={value} type="button" role="radio" className={styles.mode} aria-checked={aspect === value} disabled={busy} onClick={() => setAspect(value)}>
              {value}
            </button>
          ))}
        </div>
        </>
      ) : (
        <>
        <p id="atelier-look" className={styles.sectionTitle}>
          {t('editLook')}
        </p>
        <div className={styles.lookChoice} role="radiogroup" aria-labelledby="atelier-look">
          {LOOKS.map(([value, key]) => (
            <button key={value || 'none'} type="button" role="radio" className={styles.mode} aria-checked={look === value} disabled={busy} onClick={() => setLook(value)}>
              {t(key)}
            </button>
          ))}
        </div>
        </>
      )}

      {askConsent && <ConsentCheck id="atelier-consent" checked={consent} onChange={setConsent} />}

      <div className={styles.atelierActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!canStart}
          aria-describedby={waitingFor ? `atelier-waiting-${kind}` : undefined}
          onClick={run}
        >
          {kind === 't2i' ? t('t2iCreate', { d: formatDuration(estimates.t2i) }) : t('editApply', { d: formatDuration(estimates.edit ?? 0) })}
        </button>
        {busy && job && (
          <button type="button" className={styles.buttonGhost} onClick={() => void cancel()}>
            {t('cancel')}
          </button>
        )}
      </div>
      {waitingFor && (
        <p id={`atelier-waiting-${kind}`} className={styles.hint}>
          {t(waitingFor)}
        </p>
      )}

      <p className="visually-hidden" role="status">
        {busy ? t('announceRendering') : done ? t('atelierReady') : ''}
      </p>
      {busy && job && (
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
          <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}

      {(refusal || failed) && (
        <p className={styles.photoError} role="alert">
          {refusal ? t(refusalMessageKey(refusal)) : job?.error === 'lost' ? t('lost') : job?.state === 'canceled' ? t('canceled') : t('failed', { error: job?.error ?? '?' })}
        </p>
      )}

      {(done || (kind === 'edit' && before.status === 'ready')) && (
        <div className={styles.atelierImages} data-pair={kind === 'edit'}>
          {kind === 'edit' && before.status === 'ready' && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- the photo being edited */}
              <img src={before.localUrl} alt="" />
              <figcaption>{t('editBefore')}</figcaption>
            </figure>
          )}
          {done && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- the image just made */}
              <img src={done.outputUrl} alt="" data-testid="atelier-result" />
              <AiCaption
                as="figcaption"
                prefix={kind === 'edit' ? `${t('editAfter')} · ` : undefined}
                model={{ id: done.modelId, name: done.label.name ?? done.modelId, license: licenseOf(done.modelId) ?? '?' }}
              />
            </figure>
          )}
        </div>
      )}

      {done && (
        <div className={styles.atelierActions}>
          <button type="button" className={styles.buttonSecondary} onClick={use}>
            {t('photoUse')}
          </button>
          {kind === 't2i' ? (
            <button type="button" className={styles.buttonGhost} onClick={run} disabled={!canStart}>
              {t('t2iRetry')}
            </button>
          ) : (
            <button type="button" className={styles.buttonGhost} onClick={onClose}>
              {t('editKeep')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
