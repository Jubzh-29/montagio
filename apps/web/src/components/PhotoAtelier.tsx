'use client';

import { useRef, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch } from '@/lib/api';
import { formatDuration } from '@/lib/duration';
import type { ExtensionsInfo, UploadResult } from '@/lib/api-types';
import { needsConsent } from '@/lib/consent';
import {
  MOODBOARD_REFS_MAX,
  PALETTE_COLORS,
  PALETTE_FROM_PHOTO_INSTRUCTION,
  paletteInstruction,
  paletteKey,
  PALETTES,
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
/** With a moodboard the text leaves room for the restyling (MOODBOARD_TEXT_MAX on the server). */
const MOODBOARD_TEXT_MAX = 300;

/** A picture the visitor added: a moodboard reference, or the photo whose colors a palette takes. */
type Picked = { imageRef: string; url: string; personal: boolean };

async function uploadPicture(file: File): Promise<Picked | null> {
  const form = new FormData();
  form.append('image', file);
  const res = await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null);
  if (!res?.ok) return null;
  const meta = (await res.json()) as UploadResult;
  return { imageRef: meta.imageRef, url: `/media/data/${meta.imageRef}`, personal: meta.personal };
}

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
  // Moodboard (text to image): references whose look the picture takes; the edit is needed for it.
  const [refs, setRefs] = useState<Picked[]>([]);
  // Change palette (edit): the photo whose colors the edit takes, as its second image.
  const [palettePhoto, setPalettePhoto] = useState<Picked | null>(null);
  const [pickFailed, setPickFailed] = useState(false);
  const moodboard = kind === 't2i' && refs.length > 0;
  const textMax = moodboard ? MOODBOARD_TEXT_MAX : TEXT_MAX;
  const [consent, setConsent] = useState(false);
  // Another photo, reference or palette photo asks for consent again (state adjusted while rendering).
  const photoKey = [photo.status === 'ready' ? photo.imageRef : '', ...refs.map((ref) => ref.imageRef), palettePhoto?.imageRef ?? ''].join('|');
  const [consentFor, setConsentFor] = useState(photoKey);
  if (consentFor !== photoKey) {
    setConsentFor(photoKey);
    setConsent(false);
  }
  // An edit shows the photo it started from, even when the visitor loads another one meanwhile.
  const [source, setSource] = useState<UploadState | null>(null);
  const before = job && source ? source : photo;
  const askConsent =
    kind === 'edit' ? needsConsent(photo, 'edit') || palettePhoto?.personal === true : refs.some((ref) => ref.personal);
  const done = job?.state === 'succeeded' && job.outputImageRef && job.outputUrl ? job : null;
  const canStart =
    text.trim().length > 0 &&
    text.trim().length <= textMax &&
    !busy &&
    (!askConsent || consent) &&
    (kind === 't2i' || (photo.status === 'ready' && (!inpaint || maskPainted)));
  // What a disabled button waits for, said under it: the photo first, then the text, then the consent.
  const waitingFor: MessageKey | null = busy
    ? null
    : kind === 'edit' && photo.status !== 'ready'
      ? 'editNeedsPhoto'
      : !text.trim()
        ? kind === 't2i'
          ? 't2iNeedsText'
          : 'editNeedsText'
        : text.trim().length > textMax
          ? 'moodboardTextTooLong'
          : askConsent && !consent
            ? kind === 'edit'
              ? 'editNeedsConsent'
              : 'moodboardNeedsConsent'
            : kind === 'edit' && inpaint && !maskPainted
              ? 'inpaintNeedsPaint'
              : null;
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
      const body = { prompt: text.trim(), aspect, ...(Object.keys(chosen).length > 0 ? { style: chosen } : {}) };
      if (moodboard) void start('/api/moodboards', { ...body, refs: refs.map((ref) => ref.imageRef), ...(askConsent ? { consent } : {}) });
      else void start('/api/images', body);
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
        ...(palettePhoto ? { image2Ref: palettePhoto.imageRef } : {}),
      });
    }
  };

  /** A picture from the visitor's files: a moodboard reference, or the palette's photo. */
  const pick = async (file: File | undefined, into: 'ref' | 'palette') => {
    if (!file) return;
    setPickFailed(false);
    const picked = await uploadPicture(file);
    if (!picked) return setPickFailed(true);
    if (into === 'ref') setRefs((current) => (current.length < MOODBOARD_REFS_MAX ? [...current, picked] : current));
    else {
      setPalettePhoto(picked);
      setText(PALETTE_FROM_PHOTO_INSTRUCTION);
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
        {t('charCount', { n: text.length, max: textMax })}
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
          {estimates.edit !== undefined && (
            <div className={styles.panelSection}>
              <p id="atelier-moodboard" className={styles.sectionTitle}>
                {t('moodboardTitle')}
              </p>
              <p className={styles.hint}>{t('moodboardHint', { n: MOODBOARD_REFS_MAX })}</p>
              <ul className={styles.moodboard} aria-labelledby="atelier-moodboard">
                {refs.map((ref, index) => (
                  <li key={ref.imageRef} className={styles.moodboardRef}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a reference picture */}
                    <img src={ref.url} alt="" />
                    <button
                      type="button"
                      className={styles.chip}
                      disabled={busy}
                      aria-label={t('moodboardRemove', { n: index + 1 })}
                      onClick={() => setRefs((current) => current.filter((entry) => entry.imageRef !== ref.imageRef))}
                    >
                      {t('composeRemove')}
                    </button>
                  </li>
                ))}
                {refs.length < MOODBOARD_REFS_MAX && (
                  <li className={styles.moodboardAdd}>
                    <input
                      id="moodboard-input"
                      className="visually-hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(event) => {
                        void pick(event.target.files?.[0], 'ref');
                        event.target.value = '';
                      }}
                    />
                    <label htmlFor="moodboard-input" className={styles.moodboardAddLabel} aria-disabled={busy || undefined}>
                      {t('moodboardAdd')}
                    </label>
                  </li>
                )}
              </ul>
            </div>
          )}
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
          <div className={styles.styleRow} role="group" aria-label={t('paletteTitle')}>
            <span className={styles.styleLabel} aria-hidden="true">
              {t('paletteTitle')}
            </span>
            {PALETTES.map((palette) => (
              <button
                key={palette}
                type="button"
                className={styles.chip}
                disabled={busy}
                onClick={() => {
                  setPalettePhoto(null);
                  setText(paletteInstruction(palette));
                }}
              >
                <span className={styles.swatches} aria-hidden="true">
                  {PALETTE_COLORS[palette].swatches.map((colour) => (
                    <span key={colour} style={{ background: colour }} />
                  ))}
                </span>
                {t(paletteKey(palette))}
              </button>
            ))}
            <input
              id="palette-input"
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || inpaint}
              onChange={(event) => {
                void pick(event.target.files?.[0], 'palette');
                event.target.value = '';
              }}
            />
            <label htmlFor="palette-input" className={styles.chip} aria-disabled={busy || inpaint || undefined}>
              {t('paletteFromPhoto')}
            </label>
          </div>
          {palettePhoto && (
            <div className={styles.palettePhoto}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the photo whose colors the edit takes */}
              <img src={palettePhoto.url} alt="" />
              <span className={styles.hint}>{t('paletteFromPhotoHint')}</span>
              <button type="button" className={styles.chip} disabled={busy} onClick={() => setPalettePhoto(null)}>
                {t('composeRemove')}
              </button>
            </div>
          )}
          <div className={styles.styleRow}>
            <span className={styles.styleLabel} aria-hidden="true">
              {t('inpaintLabel')}
            </span>
            <button type="button" className={styles.chip} aria-pressed={inpaint} disabled={busy || photo.status !== 'ready' || palettePhoto !== null} onClick={() => setInpaint(!inpaint)}>
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

      {pickFailed && (
        <p className={styles.photoError} role="alert">
          {t('composeUploadFailed')}
        </p>
      )}

      {askConsent && <ConsentCheck id="atelier-consent" checked={consent} onChange={setConsent} />}

      <div className={styles.atelierActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!canStart}
          aria-describedby={waitingFor ? `atelier-waiting-${kind}` : undefined}
          onClick={() => void run()}
        >
          {kind === 't2i'
            ? moodboard
              ? t('moodboardCreate', { d: formatDuration(estimates.t2i + (estimates.edit ?? 0)) })
              : t('t2iCreate', { d: formatDuration(estimates.t2i) })
            : t('editApply', { d: formatDuration(estimates.edit ?? 0) })}
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
