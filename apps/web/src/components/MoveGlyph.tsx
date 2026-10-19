'use client';

import type { CSSProperties } from 'react';
import { glyphMotion } from '@/lib/move-glyph';
import styles from './studio.module.css';

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/**
 * A camera move drawn in a viewfinder: the scene drifts behind the frame marks
 * as the camera moves, and the dashed target frame shows where the shot ends.
 * `replay` restarts the move (the monitor replays it when the preset changes).
 */
export function MoveGlyph({
  poses,
  speed,
  variant = 'tile',
  replay,
}: {
  poses: string[];
  speed: number;
  variant?: 'tile' | 'monitor';
  replay?: string;
}) {
  const { mid, end, durationS, target } = glyphMotion(poses, speed);
  const at = mid ?? end;
  const style = {
    '--tx': percent(end.tx),
    '--ty': percent(end.ty),
    '--scale': end.scale,
    '--mid-tx': percent(at.tx),
    '--mid-ty': percent(at.ty),
    '--mid-scale': at.scale,
    '--move-duration': `${durationS.toFixed(2)}s`,
  } as CSSProperties;
  return (
    <span className={variant === 'monitor' ? `${styles.glyph} ${styles.viewfinder}` : styles.glyph} aria-hidden="true">
      <span key={replay} className={styles.glyphScene} data-chained={mid !== undefined} style={style}>
        <span className={styles.glyphHorizon} />
        <span className={styles.glyphSubject} />
        <span
          className={styles.glyphTarget}
          style={{ left: `${target.left}%`, top: `${target.top}%`, width: `${target.width}%`, height: `${target.height}%` }}
        />
      </span>
      <span className={styles.glyphFrame} />
    </span>
  );
}
