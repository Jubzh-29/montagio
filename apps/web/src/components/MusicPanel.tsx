'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { AiCaption } from './AiCaption';
import styles from './studio.module.css';

const PROMPT_MAX = 300;
const DEFAULT_BPM = 90;

/**
 * Under a finished film: an instrumental soundtrack (a description, a tempo), mixed under the
 * film and its 9:16 cut. The silent versions stay where they are; each music is a new film.
 */
export function MusicPanel({
  sequenceId,
  estimate_s,
  model,
}: {
  sequenceId: string;
  estimate_s: number;
  /** The music model, for the caption under the film with music. */
  model?: { name: string; license: string };
}) {
  const { t } = useI18n();
  const { job, refusal, busy, start, cancel } = useJob();
  const [prompt, setPrompt] = useState('');
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const done = job?.state === 'succeeded' && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const validBpm = Number.isInteger(bpm) && bpm >= 10 && bpm <= 300;
  const canStart = prompt.trim().length > 0 && validBpm && !busy;
  const percent = job ? Math.round(job.progress * 100) : 0;

  const run = () => {
    if (canStart) void start(`/api/sequences/${encodeURIComponent(sequenceId)}/music`, { prompt: prompt.trim(), bpm });
  };

  return (
    <section className={styles.panelSection} aria-labelledby="music-title">
      <h2 id="music-title" className={styles.sectionTitle}>
        {t('musicTitle')}
      </h2>
      <label htmlFor="music-prompt" className={styles.sectionTitle}>
        {t('musicPrompt')}
      </label>
      <textarea
        id="music-prompt"
        className={styles.prompt}
        rows={2}
        maxLength={PROMPT_MAX}
        value={prompt}
        disabled={busy}
        placeholder={t('musicPromptPlaceholder')}
        aria-describedby="music-count"
        onChange={(event) => setPrompt(event.target.value)}
      />
      <p id="music-count" className={styles.counter}>
        {t('charCount', { n: prompt.length, max: PROMPT_MAX })}
      </p>
      <label htmlFor="music-bpm" className={styles.sectionTitle}>
        {t('musicBpm')}
      </label>
      <input
        id="music-bpm"
        type="number"
        className={styles.prompt}
        min={10}
        max={300}
        step={1}
        value={Number.isNaN(bpm) ? '' : bpm}
        disabled={busy}
        onChange={(event) => setBpm(event.target.valueAsNumber)}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.buttonPrimary} disabled={!canStart} onClick={run}>
          {t('musicAdd', { s: estimate_s })}
        </button>
        {busy && job && (
          <button type="button" className={styles.buttonGhost} onClick={() => void cancel()}>
            {t('cancel')}
          </button>
        )}
      </div>
      {busy && job && (
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
          <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      {(refusal || failed) && (
        <p className={styles.photoError} role="alert">
          {refusal
            ? t(refusalMessageKey(refusal))
            : job?.state === 'canceled'
              ? t('canceled')
              : refusalMessageKey(job?.error) !== 'errorGeneric'
                ? t(refusalMessageKey(job?.error))
                : t('failed', { error: job?.error ?? '?' })}
        </p>
      )}
      {done && (
        <>
          <div className={styles.actions}>
            <a className={styles.buttonSecondary} href={done.outputUrl} download="montagio-film-music.mp4">
              {t('musicDownload')}
            </a>
            {done.verticalUrl && (
              <a className={styles.buttonSecondary} href={done.verticalUrl} download="montagio-film-music-9x16.mp4">
                {t('musicDownloadVertical')}
              </a>
            )}
          </div>
          {model && (
            <AiCaption testId="music-caption" model={model} />
          )}
        </>
      )}
    </section>
  );
}
