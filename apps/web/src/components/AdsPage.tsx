'use client';

import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { CharacterSummary, UploadResult } from '@/lib/api-types';
import { formatDuration } from '@/lib/duration';
import { refusalMessageKey } from '@/lib/refusals';
import { useExtensions } from '@/lib/use-extensions';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './ads.module.css';
import studio from './studio.module.css';

type Photo = { imageRef: string; url: string; personal: boolean };
const STYLES: [string, MessageKey][] = [
  ['studio', 'adStyleStudio'],
  ['lifestyle', 'adStyleLifestyle'],
  ['bold', 'adStyleBold'],
];
const TAGLINE_MAX = 60;

/** The tagline as the browser draws it: white letters on a dark fade at the top, the size of the 9:16 cut. */
async function drawTagline(text: string): Promise<Blob | null> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const fade = context.createLinearGradient(0, 0, 0, 420);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = fade;
  context.fillRect(0, 0, 720, 420);
  context.font = `700 60px ${getComputedStyle(document.body).fontFamily}`;
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  // Two lines at most, cut on words.
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && context.measureText(`${last} ${word}`).width <= 640) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  lines.slice(0, 2).forEach((line, index) => context.fillText(line, 360, 110 + index * 72));
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function uploadImage(file: File): Promise<Photo | null> {
  const form = new FormData();
  form.append('image', file);
  const res = await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null);
  if (!res?.ok) return null;
  const meta = (await res.json()) as UploadResult;
  return { imageRef: meta.imageRef, url: `/media/data/${meta.imageRef}`, personal: meta.personal };
}

function PhotoPick({ id, label, hint, photo, disabled, onPhoto }: { id: string; label: MessageKey; hint: MessageKey; photo: Photo | null; disabled: boolean; onPhoto: (photo: Photo | null) => void }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.pick}>
      <div className={styles.thumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo */}
        {photo ? <img src={photo.url} alt="" /> : <span aria-hidden="true">+</span>}
      </div>
      <div className={styles.pickText}>
        <span className={studio.sectionTitle}>{t(label)}</span>
        <span className={studio.hint}>{t(hint)}</span>
        <input
          id={id}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const uploaded = await uploadImage(file);
            setFailed(!uploaded);
            if (uploaded) onPhoto(uploaded);
          }}
        />
        <label htmlFor={id} className={studio.chip} aria-disabled={disabled || undefined}>
          {photo ? t('composeReplace') : t('composeAdd')}
        </label>
        {failed && (
          <span className={studio.photoError} role="alert">
            {t('composeUploadFailed')}
          </span>
        )}
      </div>
    </div>
  );
}

/** The ad studio: a product, a character if you like, a style, an effect and a tagline give a 9:16 ad with music. */
export function AdsPage() {
  const { t } = useI18n();
  const info = useExtensions();
  const { job, refusal, busy, start } = useJob();
  const [product, setProduct] = useState<Photo | null>(null);
  const [character, setCharacter] = useState<Photo | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [style, setStyle] = useState('studio');
  const [effectId, setEffectId] = useState<string | null>(null);
  const [tagline, setTagline] = useState('');
  const [consent, setConsent] = useState(false);
  const [drawFailed, setDrawFailed] = useState(false);

  useEffect(() => {
    if (IS_SHOWCASE) return;
    apiFetch('/api/characters')
      .then((res) => jsonOrThrow<CharacterSummary[]>(res))
      .then(setCharacters)
      .catch(() => undefined);
  }, []);

  const effects = info?.effects ?? [];
  const effect = effects.find((entry) => entry.id === effectId) ?? effects[0];
  const available = Boolean(info && info.extensions.includes('edit') && info.extensions.includes('music') && effects.length > 0);
  const askConsent = Boolean(product?.personal || character?.personal);
  const seconds = (info?.estimates.edit ?? 0) + (effect?.estimate_s ?? 0) + (info?.estimates.music ?? 0);
  const canStart = available && product !== null && effect !== undefined && !busy && (!askConsent || consent);
  const done = job?.state === 'succeeded' && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const percent = job ? Math.round(job.progress * 100) : 0;

  const make = async () => {
    if (!canStart || !product || !effect) return;
    setDrawFailed(false);
    let overlayRef: string | undefined;
    if (tagline.trim()) {
      const blob = await drawTagline(tagline.trim());
      const drawn = blob ? await uploadImage(new File([blob], 'tagline.png', { type: 'image/png' })) : null;
      if (!drawn) return setDrawFailed(true);
      overlayRef = drawn.imageRef;
    }
    void start('/api/ads', {
      productRef: product.imageRef,
      ...(character ? { characterRef: character.imageRef } : {}),
      style,
      effectId: effect.id,
      ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
      ...(overlayRef ? { overlayRef } : {}),
      ...(askConsent ? { consent } : {}),
    });
  };

  const characterPictures = characters.flatMap((entry) => [
    { key: entry.imageRef, name: entry.name, photo: { imageRef: entry.imageRef, url: entry.imageUrl, personal: false } },
    ...entry.photos.map((picture, index) => ({ key: picture.imageRef, name: `${entry.name} · ${index + 1}`, photo: { imageRef: picture.imageRef, url: picture.url, personal: false } })),
  ]);

  return (
    <>
      <Header current="ads" />
      <main id="content" tabIndex={-1} className={styles.page}>
        <div className={styles.intro}>
          <h1 className={styles.title}>{t('adsTitle')}</h1>
          <p className={styles.lead}>{t('adsLead')}</p>
        </div>
        {IS_SHOWCASE ? (
          <p className={studio.hint}>{t('adsShowcase')}</p>
        ) : !available ? (
          <p className={studio.hint}>{t('adsNeedsExtensions')}</p>
        ) : (
          <div className={styles.layout}>
            <section className={styles.panel} aria-labelledby="ad-setup">
              <h2 id="ad-setup" className={styles.panelTitle}>
                {t('adsSetup')}
              </h2>
              <PhotoPick id="ad-product" label="adProduct" hint="adProductHint" photo={product} disabled={busy} onPhoto={setProduct} />
              <PhotoPick id="ad-character" label="adCharacter" hint="adCharacterHint" photo={character} disabled={busy} onPhoto={setCharacter} />
              <div className={studio.styleRow}>
                {characterPictures.length > 0 && (
                  <select
                    className={studio.composeSelect}
                    aria-label={t('composeFromCharacters')}
                    value=""
                    disabled={busy}
                    onChange={(event) => setCharacter(characterPictures.find((picture) => picture.key === event.target.value)?.photo ?? character)}
                  >
                    <option value="">{t('composeFromCharacters')}</option>
                    {characterPictures.map((picture) => (
                      <option key={picture.key} value={picture.key}>
                        {picture.name}
                      </option>
                    ))}
                  </select>
                )}
                {character && (
                  <button type="button" className={studio.chip} disabled={busy} onClick={() => setCharacter(null)}>
                    {t('composeRemove')}
                  </button>
                )}
              </div>

              <div className={studio.styleRow} role="radiogroup" aria-label={t('adStyle')}>
                <span className={studio.styleLabel} aria-hidden="true">
                  {t('adStyle')}
                </span>
                {STYLES.map(([id, key]) => (
                  <button key={id} type="button" role="radio" className={studio.chip} aria-checked={style === id} disabled={busy} onClick={() => setStyle(id)}>
                    {t(key)}
                  </button>
                ))}
              </div>
              <div className={studio.styleRow} role="radiogroup" aria-label={t('adEffect')}>
                <span className={studio.styleLabel} aria-hidden="true">
                  {t('adEffect')}
                </span>
                {effects.map((entry) => (
                  <button key={entry.id} type="button" role="radio" className={studio.chip} aria-checked={effect?.id === entry.id} disabled={busy} onClick={() => setEffectId(entry.id)}>
                    {entry.name}
                  </button>
                ))}
              </div>

              <label htmlFor="ad-tagline" className={studio.sectionTitle}>
                {t('adTagline')}
              </label>
              <input
                id="ad-tagline"
                className={studio.prompt}
                type="text"
                maxLength={TAGLINE_MAX}
                placeholder={t('adTaglinePlaceholder')}
                value={tagline}
                disabled={busy}
                onChange={(event) => setTagline(event.target.value)}
              />
              <p className={studio.counter}>{t('charCount', { n: tagline.length, max: TAGLINE_MAX })}</p>

              {askConsent && <ConsentCheck id="ad-consent" checked={consent} onChange={setConsent} />}
              <button type="button" className={studio.buttonPrimary} disabled={!canStart} onClick={() => void make()}>
                {t('adMake', { d: formatDuration(seconds) })}
              </button>
              {!product && <p className={studio.hint}>{t('adNeedsProduct')}</p>}
            </section>

            <section className={styles.result} aria-labelledby="ad-result" aria-live="polite">
              <h2 id="ad-result" className={studio.sectionTitle}>
                {t('adResult')}
              </h2>
              {busy && job && (
                <div className={studio.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
                  <span className={studio.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
                </div>
              )}
              {(refusal || failed || drawFailed) && (
                <p className={studio.photoError} role="alert">
                  {drawFailed ? t('composeUploadFailed') : refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}
                </p>
              )}
              {done ? (
                <>
                  <video className={styles.video} src={done.outputUrl} controls playsInline />
                  <a className={studio.buttonSecondary} href={done.outputUrl} download="montagio-ad.mp4">
                    {t('adDownload')}
                  </a>
                  <p className={studio.hint}>{t('adCaption')}</p>
                </>
              ) : (
                !busy && <p className={styles.empty}>{t('adEmpty')}</p>
              )}
            </section>
          </div>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
