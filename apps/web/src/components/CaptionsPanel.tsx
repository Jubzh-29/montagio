'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CAPTION_STYLE_IDS, type CaptionStyleId } from '@montagio/captions';
import { useI18n } from '@/i18n';
import { apiFetch } from '@/lib/api';
import type { CaptionExportSummary, CaptionsInfo, DemoKind } from '@/lib/api-types';
import { canExport, CAPTION_LANGUAGE_CHOICES, CAPTION_TEXT_MAX, languageLabel, STYLE_LABEL } from '@/lib/captions';
import { refusalMessageKey } from '@/lib/refusals';
import { useJob } from '@/lib/use-job';
import { AiCaption } from './AiCaption';
import { RecipePanel } from './RecipePanel';
import captions from './captions.module.css';
import styles from './studio.module.css';

const PREVIEW_DELAY_MS = 600;
const EXPORT_POLL_MS = 1000;

/** A style's sample, drawn in its own font and colours: what the captions will look like, before the preview comes back. */
function StyleSample({ style }: { style: CaptionStyleId }) {
  switch (style) {
    case 'karaoke':
      return (
        <span className={captions.sampleKaraoke}>
          <span className={captions.karaokeLit}>Hel</span>lo
        </span>
      );
    case 'pop':
      return (
        <span className={captions.samplePop}>
          SAY <span className={captions.popLit}>IT</span>
        </span>
      );
    case 'word':
      return <span className={captions.sampleWord}>WORD</span>;
    case 'classic':
      return <span className={captions.sampleClassic}>Hello</span>;
    case 'neon':
      return (
        <span className={captions.sampleNeon}>
          GLOW <span className={captions.neonLit}>ON</span>
        </span>
      );
  }
}

/**
 * Under a finished talking clip: captions burned in word by word, in 9:16 for TikTok, Reels and Shorts.
 * Whisper hears the clip (a captions job), the user corrects the words and picks a style, the preview is
 * one frame of the real export (same FFmpeg and libass), then Export 9:16 renders the clip. Its recipe
 * travels in the MP4 and shows in the History, where the export is a clip of its own.
 */
type ModelSummary = { id: string; name: string; license: string };

export function CaptionsPanel({
  parentJobId,
  parentTask,
  estimate_s,
  model,
  clip,
}: {
  parentJobId: string;
  /** What the clip is: a voice change or a translation cannot be replayed from its recipe (the user's speech file). */
  parentTask: 'avatar' | 'translate' | 'voice-change';
  estimate_s: number;
  /** Whisper, credited for the captions. */
  model: ModelSummary;
  /** The model that made the clip, for its AI-generated caption; without it, the generic mention. */
  clip?: { model: ModelSummary; demoKind?: DemoKind };
}) {
  const { t, lang } = useI18n();
  const transcription = useJob();
  const job = transcription.job;
  const ready = job?.state === 'succeeded' ? job : null;
  const [info, setInfo] = useState<CaptionsInfo | null>(null);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<CaptionStyleId>('karaoke');
  const [preview, setPreview] = useState<{ url: string | null; loading: boolean }>({ url: null, loading: false });
  const [exported, setExported] = useState<CaptionExportSummary | null>(null);
  /** The text and the style the last export burned in: once either changes, the preview comes back. */
  const [exportedFor, setExportedFor] = useState<{ text: string; style: CaptionStyleId } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  // The transcript, once Whisper is done: the editor starts from its suggested text.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void apiFetch(`/api/captions/${encodeURIComponent(ready.id)}`)
      .then((res) => (res.ok ? (res.json() as Promise<CaptionsInfo>) : null))
      .then((got) => {
        if (!live || !got) return;
        setInfo(got);
        setText(got.transcript.suggested);
        setExported(null);
      })
      .catch(() => live && setRefusal('errorGeneric'));
    return () => {
      live = false;
    };
  }, [ready]);

  // The exact preview: one frame of the export, after a pause in the typing or at once for a new style.
  const supported = info?.transcript.supported ?? false;
  useEffect(() => {
    if (!info || !supported || !text.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview((current) => ({ ...current, loading: true }));
      try {
        const res = await apiFetch(`/api/captions/${encodeURIComponent(info.jobId)}/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, style, language: info.transcript.language }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const url = URL.createObjectURL(await res.blob());
        setPreview((current) => {
          if (current.url) URL.revokeObjectURL(current.url);
          return { url, loading: false };
        });
      } catch {
        if (!controller.signal.aborted) setPreview((current) => ({ ...current, loading: false }));
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [info, supported, text, style]);

  useEffect(() => () => void (preview.url && URL.revokeObjectURL(preview.url)), [preview.url]);

  // An export runs on the server: its state is polled until it ends.
  useEffect(() => {
    if (!info || exported?.state !== 'running') return;
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/captions/${encodeURIComponent(info.jobId)}/export/${encodeURIComponent(exported.id)}`).catch(() => null);
      if (res?.ok) setExported((await res.json()) as CaptionExportSummary);
      // An export the server no longer knows (data wiped) ends here instead of polling on.
      else if (res?.status === 404) setExported({ ...exported, state: 'failed', error: 'lost' });
      else setExported({ ...exported });
    }, EXPORT_POLL_MS);
    return () => clearTimeout(timer);
  }, [info, exported]);

  const transcribe = (language: string) => {
    setInfo(null);
    setExported(null);
    setRefusal(null);
    void transcription.start(`/api/jobs/${encodeURIComponent(parentJobId)}/captions`, { language });
  };

  const exporting = exported?.state === 'running';
  const startExport = async () => {
    if (!info) return;
    setRefusal(null);
    const res = await apiFetch(`/api/captions/${encodeURIComponent(info.jobId)}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, style, language: info.transcript.language }),
    }).catch(() => null);
    if (!res) return setRefusal('errorGeneric');
    const body = (await res.json().catch(() => ({}))) as CaptionExportSummary & { error?: string };
    if (!res.ok) return setRefusal(body.error ?? 'errorGeneric');
    setExported(body);
    setExportedFor({ text, style });
  };

  // Arrow keys move the choice along the styles, as in any radio group.
  const onStyleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + CAPTION_STYLE_IDS.length) % CAPTION_STYLE_IDS.length;
    setStyle(CAPTION_STYLE_IDS[next]!);
    radios.current[next]?.focus();
  };

  const percent = job ? Math.round(job.progress * 100) : 0;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const transcript = info?.transcript;
  const current = exportedFor?.text === text && exportedFor.style === style;
  const done = exported?.state === 'succeeded' && exported.url && current ? exported : null;

  return (
    <section className={`${styles.panelSection} ${captions.panel}`} aria-labelledby={`captions-${parentJobId}`} data-testid="captions-panel">
      <div className={captions.head}>
        <h3 id={`captions-${parentJobId}`} className={styles.sectionTitle}>
          {t('captionsAction')}
        </h3>
        <p className={styles.hint}>{t('captionsIntro')}</p>
      </div>

      {!job && (
        <div className={styles.actions}>
          <button type="button" className={styles.buttonSecondary} onClick={() => transcribe('auto')}>
            {t('captionsMake')}
            <span className={captions.estimate}>~{Math.max(1, Math.round(estimate_s))} s</span>
          </button>
        </div>
      )}

      {transcription.busy && job && (
        <div className={captions.listening} role="status">
          <span className={styles.hint}>{t('captionsListening')}</span>
          <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('captionsListening')}>
            <span className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <button type="button" className={styles.buttonGhost} onClick={() => void transcription.cancel()}>
            {t('cancel')}
          </button>
        </div>
      )}

      {(transcription.refusal || failed) && (
        <div className={styles.actions}>
          <p className={styles.photoError} role="alert">
            {transcription.refusal ? t(refusalMessageKey(transcription.refusal)) : job?.state === 'canceled' ? t('canceled') : t('failed')}
          </p>
          {!transcription.refusal && (
            <button type="button" className={styles.buttonSecondary} onClick={() => transcribe('auto')}>
              {t('captionsMake')}
            </button>
          )}
        </div>
      )}

      {transcript && info && (
        <div className={captions.editor}>
          <div className={captions.fields}>
            <div className={captions.language}>
              <label htmlFor={`captions-language-${parentJobId}`} className={styles.sectionTitle}>
                {t('captionsLanguage')}
              </label>
              <select
                id={`captions-language-${parentJobId}`}
                className={captions.select}
                value={transcript.detected ? 'auto' : transcript.language}
                disabled={transcription.busy || exporting}
                onChange={(event) => transcribe(event.target.value)}
              >
                {CAPTION_LANGUAGE_CHOICES.map((code) => (
                  <option key={code} value={code}>
                    {code === 'auto'
                      ? transcript.detected
                        ? t('captionsDetected', { name: languageLabel(transcript.language, lang) })
                        : t('captionsLanguageAuto')
                      : languageLabel(code, lang)}
                  </option>
                ))}
              </select>
            </div>

            {!transcript.supported && (
              <p className={captions.notice} role="status">
                {t('captionsUnsupported')}
              </p>
            )}

            <label htmlFor={`captions-text-${parentJobId}`} className={styles.sectionTitle}>
              {t('captionsText')}
            </label>
            <textarea
              id={`captions-text-${parentJobId}`}
              className={styles.prompt}
              rows={3}
              maxLength={CAPTION_TEXT_MAX}
              value={text}
              lang={transcript.language}
              disabled={!transcript.supported}
              aria-describedby={`captions-text-hint-${parentJobId}`}
              onChange={(event) => setText(event.target.value)}
              data-testid="captions-text"
            />
            <p id={`captions-text-hint-${parentJobId}`} className={styles.hint}>
              {transcript.demo ? t('captionsDemo') : t('captionsTextHint')}
            </p>

            <span id={`captions-style-${parentJobId}`} className={styles.sectionTitle}>
              {t('captionsStyle')}
            </span>
            <div className={captions.styles} role="radiogroup" aria-labelledby={`captions-style-${parentJobId}`}>
              {CAPTION_STYLE_IDS.map((id, index) => (
                <button
                  key={id}
                  ref={(element) => {
                    radios.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={style === id}
                  tabIndex={style === id ? 0 : -1}
                  className={captions.style}
                  disabled={!transcript.supported}
                  onClick={() => setStyle(id)}
                  onKeyDown={(event) => onStyleKey(event, index)}
                >
                  <span className={captions.sample} aria-hidden="true">
                    <StyleSample style={id} />
                  </span>
                  <span className={captions.styleName}>{t(STYLE_LABEL[id])}</span>
                </button>
              ))}
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.buttonSecondary} disabled={!canExport({ text, supported: transcript.supported, busy: exporting })} onClick={() => void startExport()}>
                {exporting ? t('captionsExporting') : t('captionsExport')}
              </button>
              {done && (
                <a className={styles.buttonSecondary} href={done.url} download="montagio-captions-9x16.mp4">
                  {t('captionsDownload')}
                </a>
              )}
            </div>
            {exporting && (
              <p className={styles.hint} role="status">
                {t('captionsExporting')}
              </p>
            )}
            {(refusal || exported?.state === 'failed') && (
              <p className={styles.photoError} role="alert">
                {refusal ? t(refusalMessageKey(refusal)) : t('failed')}
              </p>
            )}
          </div>

          <div className={captions.side}>
            <figure className={captions.frame} data-loading={preview.loading || exporting || undefined}>
              {done ? (
                <video className={captions.media} src={done.url} controls playsInline data-testid="captions-result" />
              ) : preview.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a blob URL of the server's frame, not a static asset
                <img className={captions.media} src={preview.url} alt={t('captionsPreview')} data-testid="captions-preview" />
              ) : (
                <span className={captions.placeholder} aria-hidden="true" />
              )}
              <span className={captions.mark} data-corner="tl" aria-hidden="true" />
              <span className={captions.mark} data-corner="br" aria-hidden="true" />
            </figure>
            {/* Under the frame, not over it: the video's own controls stay free. */}
            {done && (clip ? <AiCaption model={clip.model} testId="captions-caption" {...(clip.demoKind ? { demoKind: clip.demoKind } : {})} /> : <p className={styles.hint}>{t('adCaption')}</p>)}
            {done && <p className={styles.note}>{t('captionsCredit', { model: model.name, license: model.license })}</p>}
          </div>
        </div>
      )}

      {done && info && (
        <div className={captions.recipe}>
          <p className={styles.note}>{t('captionsRecipe')}</p>
          <RecipePanel key={done.url} url={`/api/recipes/job/${encodeURIComponent(info.jobId)}`} />
          {parentTask !== 'avatar' && <p className={styles.hint}>{t('captionsNotReplayable')}</p>}
        </div>
      )}
    </section>
  );
}
