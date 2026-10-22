'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch } from '@/lib/api';
import type { ExtensionsInfo } from '@/lib/api-types';
import { formatDuration } from '@/lib/duration';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import type { AtelierPhoto } from './PhotoAtelier';
import styles from './studio.module.css';

const SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960] } as const;
type Aspect = keyof typeof SIZES;
const COLORS = ['#111111', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#8d6e63', '#ffffff'] as const;
const BRUSHES = [
  ['s', 0.008, 'maskBrushSmall'],
  ['m', 0.02, 'maskBrushMedium'],
  ['l', 0.05, 'maskBrushLarge'],
] as const;
const TEXT_MAX = 300;

/** The edit's instruction for a drawing: the visitor's words say what it is, the drawing gives the layout. */
export function drawInstruction(what: string): string {
  return `Turn this rough drawing into a photorealistic photo of ${what.trim()}. Keep the composition, the shapes and the colors of the drawing. Natural light, sharp focus, no drawing lines left.`;
}

/**
 * Draw to video, first half: sketch the shot on a blank canvas and say what it is; the photo edit
 * turns the drawing into a photo, which becomes the start photo of a camera move or an effect.
 */
export function DrawAtelier({
  estimates,
  onUse,
  onClose,
}: {
  estimates: ExtensionsInfo['estimates'];
  onUse: (photo: AtelierPhoto) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { job, refusal, busy, start, cancel } = useJob();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [brush, setBrush] = useState<(typeof BRUSHES)[number][0]>('m');
  const [painted, setPainted] = useState(false);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [width, height] = SIZES[aspect];

  // A blank white sheet, again for each format.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, element.width, element.height);
    setPainted(false);
  }, [aspect]);

  const paint = (event: PointerEvent<HTMLCanvasElement>, first: boolean) => {
    const element = canvas.current;
    if (!element || busy) return;
    const box = element.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * element.width;
    const y = ((event.clientY - box.top) / box.height) * element.height;
    const context = element.getContext('2d')!;
    const size = (BRUSHES.find(([id]) => id === brush)![1] as number) * Math.max(element.width, element.height);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (first) {
      context.beginPath();
      context.arc(x, y, size / 2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
      context.stroke();
    }
    setPainted(true);
  };

  const clear = () => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, element.width, element.height);
    setPainted(false);
  };

  const done = job?.state === 'succeeded' && job.outputImageRef && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const canStart = painted && text.trim().length > 0 && consent && !busy;
  const percent = job ? Math.round(job.progress * 100) : 0;

  const run = async () => {
    const element = canvas.current;
    if (!canStart || !element) return;
    setSendFailed(false);
    const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
    const form = new FormData();
    if (blob) form.append('image', new File([blob], 'drawing.png', { type: 'image/png' }));
    const res = blob ? await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null) : null;
    if (!res?.ok) return setSendFailed(true);
    const { imageRef } = (await res.json()) as { imageRef: string };
    void start('/api/edits', { imageRef, instruction: drawInstruction(text), scene: text.trim(), consent });
  };

  return (
    <section className={styles.atelier} aria-labelledby="draw-title">
      <div className={styles.atelierHead}>
        <h2 id="draw-title" className={styles.atelierTitle}>
          {t('drawTitle')}
        </h2>
        <button type="button" className={styles.buttonGhost} onClick={onClose}>
          {t('atelierClose')}
        </button>
      </div>
      <p className={styles.hint}>{t('drawLead')}</p>

      <div className={styles.styleRow} role="radiogroup" aria-label={t('t2iFormat')}>
        <span className={styles.styleLabel} aria-hidden="true">
          {t('t2iFormat')}
        </span>
        {(Object.keys(SIZES) as Aspect[]).map((value) => (
          <button key={value} type="button" role="radio" className={styles.chip} aria-checked={aspect === value} disabled={busy} onClick={() => setAspect(value)}>
            {value}
          </button>
        ))}
      </div>
      <div className={styles.styleRow} role="radiogroup" aria-label={t('drawColor')}>
        <span className={styles.styleLabel} aria-hidden="true">
          {t('drawColor')}
        </span>
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            className={styles.swatch}
            style={{ background: value }}
            aria-checked={color === value}
            aria-label={value === '#ffffff' ? t('drawEraser') : value}
            disabled={busy}
            onClick={() => setColor(value)}
          />
        ))}
      </div>
      <div className={styles.styleRow} role="radiogroup" aria-label={t('maskBrush')}>
        <span className={styles.styleLabel} aria-hidden="true">
          {t('maskBrush')}
        </span>
        {BRUSHES.map(([id, , key]) => (
          <button key={id} type="button" role="radio" className={styles.chip} aria-checked={brush === id} disabled={busy} onClick={() => setBrush(id)}>
            {t(key)}
          </button>
        ))}
        <button type="button" className={styles.chip} disabled={busy} onClick={clear}>
          {t('maskClear')}
        </button>
      </div>

      <canvas
        key={aspect}
        ref={canvas}
        className={styles.drawCanvas}
        data-aspect={aspect}
        width={width}
        height={height}
        aria-label={t('drawCanvasLabel')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          paint(event, true);
        }}
        onPointerMove={(event) => drawing.current && paint(event, false)}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />

      <label htmlFor="draw-text" className={styles.sectionTitle}>
        {t('drawWhat')}
      </label>
      <textarea
        id="draw-text"
        className={styles.prompt}
        rows={2}
        maxLength={TEXT_MAX}
        placeholder={t('drawWhatPlaceholder')}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      <ConsentCheck id="draw-consent" checked={consent} onChange={setConsent} label="drawConsent" />

      <div className={styles.atelierActions}>
        <button type="button" className={styles.buttonPrimary} disabled={!canStart} onClick={() => void run()}>
          {t('drawMake', { d: formatDuration(estimates.edit ?? 15) })}
        </button>
        {busy && job && (
          <button type="button" className={styles.buttonGhost} onClick={() => void cancel()}>
            {t('cancel')}
          </button>
        )}
      </div>
      {!busy && !done && <p className={styles.hint}>{!painted ? t('drawNeedsDrawing') : !text.trim() ? t('drawNeedsText') : !consent ? t('drawNeedsConsent') : ''}</p>}
      {busy && job && (
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
          <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      {(refusal || failed || sendFailed) && (
        <p className={styles.photoError} role="alert">
          {sendFailed ? t('composeUploadFailed') : refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}
        </p>
      )}
      {done && (
        <>
          <div className={styles.atelierImages}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- the photo made from the drawing */}
              <img src={done.outputUrl} alt="" />
              <figcaption>{t('drawResult')}</figcaption>
            </figure>
          </div>
          <div className={styles.atelierActions}>
            <button type="button" className={styles.buttonSecondary} onClick={() => onUse({ imageRef: done.outputImageRef!, url: done.outputUrl!, personal: done.personal ?? true, prompt: text.trim() })}>
              {t('photoUse')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
