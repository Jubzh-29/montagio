'use client';

import { useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch } from '@/lib/api';
import type { ExtensionsInfo } from '@/lib/api-types';
import { needsConsent } from '@/lib/consent';
import {
  RELIGHTS,
  relightInstruction,
  relightKey,
  STYLE_CHOICES,
  STYLE_GROUPS,
  styleBody,
  styleChoiceKey,
  styleGroupKey,
  type StyleSelection,
} from '@/lib/image-style';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import { MaskPainter } from './MaskPainter';
import { PhotoHd } from './PhotoHd';
import type { UploadState } from './Monitor';
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
  const [style, setStyle] = useState<StyleSelection>({});
  // Inpaint: the edit changes only what is painted over the photo.
  const [inpaint, setInpaint] = useState(false);
  const [maskPainted, setMaskPainted] = useState(false);
  const [maskFailed, setMaskFailed] = useState(false);
  const maskExport = useRef<(() => Promise<Blob | null>) | null>(null);
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
  const canStart =
    text.trim().length > 0 && !busy && (kind === 't2i' || (photo.status === 'ready' && (!askConsent || consent) && (!inpaint || maskPainted)));
  const percent = job ? Math.round(job.progress * 100) : 0;

  /** The painted mask, uploaded like a photo; undefined when nothing is painted, null when the upload failed. */
  const uploadMask = async (): Promise<string | undefined | null> => {
    if (!inpaint || !maskPainted) return undefined;
    const blob = await maskExport.current?.();
    if (!blob) return undefined;
    const form = new FormData();
    form.append('image', new File([blob], 'mask.png', { type: 'image/png' }));
    const res = await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return null;
    return ((await res.json()) as { imageRef: string }).imageRef;
  };

  const run = async () => {
    if (!canStart) return;
    if (kind === 't2i') {
      const chosen = styleBody(style);
      void start('/api/images', { prompt: text.trim(), aspect, ...(Object.keys(chosen).length > 0 ? { style: chosen } : {}) });
    }
    else if (photo.status === 'ready') {
      setMaskFailed(false);
      const maskRef = await uploadMask();
      if (maskRef === null) return setMaskFailed(true);
      setSource(photo);
      void start('/api/edits', {
        imageRef: photo.imageRef,
        instruction: text.trim(),
        ...(look ? { look } : {}),
        ...(askConsent ? { consent } : {}),
        ...(maskRef ? { maskRef } : {}),
      });
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
          <div className={styles.canvasViews} role="radiogroup" aria-label={t('t2iFormat')}>
            {ASPECTS.map((value) => (
              <button key={value} type="button" role="radio" className={styles.mode} aria-checked={aspect === value} disabled={busy} onClick={() => setAspect(value)}>
                {value}
              </button>
            ))}
          </div>
          <fieldset className={styles.styleSet}>
            <legend className={styles.sectionTitle}>{t('styleTitle')}</legend>
            {STYLE_GROUPS.map((group) => (
              <div key={group} className={styles.styleRow} role="radiogroup" aria-label={t(styleGroupKey(group))}>
                <span className={styles.styleLabel} aria-hidden="true">
                  {t(styleGroupKey(group))}
                </span>
                {['', ...STYLE_CHOICES[group]].map((choice) => (
                  <button
                    key={choice || 'auto'}
                    type="button"
                    role="radio"
                    className={styles.chip}
                    aria-checked={(style[group] ?? '') === choice}
                    disabled={busy}
                    onClick={() => setStyle((current) => ({ ...current, [group]: choice }))}
                  >
                    {choice ? t(styleChoiceKey(group, choice)) : t('styleAuto')}
                  </button>
                ))}
              </div>
            ))}
          </fieldset>
        </>
      ) : (
        <>
          <div className={styles.lookChoice} role="radiogroup" aria-label={t('editLook')}>
            {LOOKS.map(([value, key]) => (
              <button key={value || 'none'} type="button" role="radio" className={styles.mode} aria-checked={look === value} disabled={busy} onClick={() => setLook(value)}>
                {t(key)}
              </button>
            ))}
          </div>
          <div className={styles.styleRow} role="group" aria-label={t('relightTitle')}>
            <span className={styles.styleLabel} aria-hidden="true">
              {t('relightTitle')}
            </span>
            {RELIGHTS.map((relight) => (
              <button key={relight} type="button" className={styles.chip} disabled={busy} onClick={() => setText(relightInstruction(relight))}>
                {t(relightKey(relight))}
              </button>
            ))}
          </div>
          <div className={styles.styleRow}>
            <span className={styles.styleLabel} aria-hidden="true">
              {t('inpaintLabel')}
            </span>
            <button type="button" className={styles.chip} aria-pressed={inpaint} disabled={busy || photo.status !== 'ready'} onClick={() => setInpaint(!inpaint)}>
              {t('inpaintToggle')}
            </button>
          </div>
          {inpaint && photo.status === 'ready' && (
            <>
              <p className={styles.hint}>{t('inpaintHint')}</p>
              <MaskPainter photoUrl={photo.localUrl} disabled={busy} onPainted={setMaskPainted} exportRef={maskExport} />
            </>
          )}
          {maskFailed && (
            <p className={styles.photoError} role="alert">
              {t('maskUploadFailed')}
            </p>
          )}
        </>
      )}

      {askConsent && <ConsentCheck id="atelier-consent" checked={consent} onChange={setConsent} />}

      <div className={styles.atelierActions}>
        <button type="button" className={styles.buttonPrimary} disabled={!canStart} onClick={() => void run()}>
          {kind === 't2i' ? t('t2iCreate', { s: estimates.t2i }) : t('editApply', { s: estimates.edit ?? 0 })}
        </button>
        {busy && job && (
          <button type="button" className={styles.buttonGhost} onClick={() => void cancel()}>
            {t('cancel')}
          </button>
        )}
      </div>

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
              <figcaption data-testid="ai-caption">
                {kind === 'edit' && `${t('editAfter')} · `}
                {t('aiCaption', { model: done.label.name ?? done.modelId, license: licenseOf(done.modelId) ?? '?' })}
              </figcaption>
            </figure>
          )}
        </div>
      )}

      {done && (
        <div className={styles.atelierActions}>
          <button type="button" className={styles.buttonSecondary} onClick={use}>
            {t('photoUse')}
          </button>
          {estimates.imageUpscale !== undefined && <PhotoHd key={done.id} imageRef={done.outputImageRef!} estimate={estimates.imageUpscale} name={kind} />}
          {kind === 't2i' ? (
            <button type="button" className={styles.buttonGhost} onClick={() => void run()} disabled={!canStart}>
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
