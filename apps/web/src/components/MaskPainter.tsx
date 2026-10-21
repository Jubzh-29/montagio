'use client';

import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from 'react';
import { useI18n } from '@/i18n';
import styles from './studio.module.css';

const BRUSHES = [
  ['s', 0.03, 'maskBrushSmall'],
  ['m', 0.06, 'maskBrushMedium'],
  ['l', 0.12, 'maskBrushLarge'],
] as const;

/**
 * Inpaint: paint over the photo what should change. The strokes are kept at the photo's own size;
 * the mask sent is white where it was painted, black elsewhere (the edit keeps the black part).
 */
export function MaskPainter({
  photoUrl,
  disabled,
  onPainted,
  exportRef,
}: {
  photoUrl: string;
  disabled: boolean;
  /** Whether anything is painted: the edit sends a mask only then. */
  onPainted: (painted: boolean) => void;
  /** Filled with the function that gives the mask as a PNG (null when nothing is painted). */
  exportRef: MutableRefObject<(() => Promise<Blob | null>) | null>;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const painted = useRef(false);
  const [brush, setBrush] = useState<(typeof BRUSHES)[number][0]>('m');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The canvas takes the photo's natural size once it is known.
  useEffect(() => {
    let alive = true;
    const image = new Image();
    image.onload = () => alive && setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = photoUrl;
    painted.current = false;
    onPainted(false);
    return () => {
      alive = false;
    };
    // A new photo starts a new mask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl]);

  useEffect(() => {
    exportRef.current = async () => {
      const source = canvas.current;
      if (!source || !painted.current) return null;
      const out = document.createElement('canvas');
      out.width = source.width;
      out.height = source.height;
      const context = out.getContext('2d')!;
      context.fillStyle = '#000';
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(source, 0, 0);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const element = canvas.current!;
    const box = element.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * element.width, y: ((event.clientY - box.top) / box.height) * element.height };
  };

  const paint = (event: PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const element = canvas.current;
    if (!element || disabled) return;
    const context = element.getContext('2d')!;
    const { x, y } = point(event);
    const width = (BRUSHES.find(([id]) => id === brush)![1] as number) * Math.max(element.width, element.height);
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (start) {
      context.beginPath();
      context.arc(x, y, width / 2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
      context.stroke();
    }
    if (!painted.current) {
      painted.current = true;
      onPainted(true);
    }
  };

  const clear = () => {
    const element = canvas.current;
    if (!element) return;
    element.getContext('2d')!.clearRect(0, 0, element.width, element.height);
    painted.current = false;
    onPainted(false);
  };

  return (
    <div className={styles.maskPainter}>
      <div className={styles.maskStage}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the photo being painted on */}
        <img src={photoUrl} alt="" draggable={false} />
        {size && (
          <canvas
            ref={canvas}
            className={styles.maskCanvas}
            width={size.width}
            height={size.height}
            aria-label={t('maskCanvasLabel')}
            data-disabled={disabled}
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
        )}
      </div>
      <div className={styles.styleRow} role="radiogroup" aria-label={t('maskBrush')}>
        <span className={styles.styleLabel} aria-hidden="true">
          {t('maskBrush')}
        </span>
        {BRUSHES.map(([id, , key]) => (
          <button key={id} type="button" role="radio" className={styles.chip} aria-checked={brush === id} disabled={disabled} onClick={() => setBrush(id)}>
            {t(key)}
          </button>
        ))}
        <button type="button" className={styles.chip} disabled={disabled} onClick={clear}>
          {t('maskClear')}
        </button>
      </div>
    </div>
  );
}
