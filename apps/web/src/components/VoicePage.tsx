'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { HistoryItem } from '@/lib/api-types';
import { formatDuration } from '@/lib/duration';
import { MAX_VIDEO_BYTES } from '@/lib/limits';
import { refusalMessageKey } from '@/lib/refusals';
import { useExtensions } from '@/lib/use-extensions';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import page from './ads.module.css';
import studio from './studio.module.css';
import styles from './voice.module.css';

type Speech = { speechRef: string; url: string; duration_s: number };
type Sample = { voiceRef: string; duration_s: number };
type Upload = 'idle' | 'uploading' | 'failed';

/** An avatar of the history, by the id of its job ("job:<id>"). */
const jobIdOf = (item: HistoryItem) => item.key.slice('job:'.length);

/**
 * The voice change: a clip where someone speaks (a video sent here, or an avatar made here) and a
 * voice sample its speaker agreed to lend give the same clip, words and rhythm kept, in that voice.
 */
export function VoicePage() {
  const { t } = useI18n();
  const info = useExtensions();
  const { job, refusal, busy, start } = useJob();
  const [source, setSource] = useState<'video' | 'avatar'>('video');
  const [speech, setSpeech] = useState<Speech | null>(null);
  const [speechState, setSpeechState] = useState<Upload>('idle');
  const [rights, setRights] = useState(false);
  const [avatars, setAvatars] = useState<HistoryItem[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [sampleState, setSampleState] = useState<Upload>('idle');
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (IS_SHOWCASE) return;
    // From the Avatar tab's result: /voice?from=<job id> starts on that avatar.
    const from = new URLSearchParams(window.location.search).get('from');
    apiFetch('/api/history')
      .then((res) => jsonOrThrow<HistoryItem[]>(res))
      .then((items) => {
        const made = items.filter((item) => item.source === 'job' && item.task === 'avatar');
        setAvatars(made);
        if (from && made.some((item) => jobIdOf(item) === from)) {
          setSource('avatar');
          setAvatarId(from);
        }
      })
      .catch(() => undefined);
  }, []);

  const uploadSpeech = async (file: File) => {
    setSpeech(null);
    setRights(false);
    if (file.size > MAX_VIDEO_BYTES) return setSpeechState('failed');
    setSpeechState('uploading');
    const form = new FormData();
    form.append('video', file);
    const res = await apiFetch('/api/uploads/speech', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return setSpeechState('failed');
    setSpeech((await res.json()) as Speech);
    setSpeechState('idle');
  };

  const uploadSample = async (file: File) => {
    setSample(null);
    setConsent(false);
    setSampleState('uploading');
    const form = new FormData();
    form.append('audio', file);
    const res = await apiFetch('/api/uploads/voice', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return setSampleState('failed');
    setSample((await res.json()) as Sample);
    setSampleState('idle');
  };

  const available = Boolean(info?.extensions.includes('avatar') && info.estimates.voiceChange !== undefined);
  const avatar = avatars.find((item) => jobIdOf(item) === avatarId) ?? null;
  const clipReady = source === 'video' ? speech !== null && rights : avatar !== null;
  const canStart = available && clipReady && sample !== null && consent && !busy;
  const done = job?.state === 'succeeded' && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const percent = job ? Math.round(job.progress * 100) : 0;

  const make = () => {
    if (!canStart || !sample) return;
    void start('/api/voice-changes', {
      ...(source === 'video' && speech ? { speechRef: speech.speechRef, rights } : { sourceJobId: avatarId }),
      voiceRef: sample.voiceRef,
      voiceConsent: consent,
    });
  };

  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className={page.page}>
        <div className={page.intro}>
          <h1 className={page.title}>{t('voiceChangeTitle')}</h1>
          <p className={page.lead}>{t('voiceChangeLead')}</p>
        </div>
        {IS_SHOWCASE ? (
          <p className={studio.hint}>{t('charactersShowcase')}</p>
        ) : !available ? (
          <p className={studio.hint}>{t('voiceChangeNeedsExtension')}</p>
        ) : (
          <div className={page.layout}>
            <section className={page.panel} aria-labelledby="voice-setup">
              <h2 id="voice-setup" className={page.panelTitle}>
                {t('voiceChangeSetup')}
              </h2>

              <div className={studio.canvasViews} role="group" aria-label={t('voiceSourceLabel')}>
                <button type="button" className={studio.mode} aria-pressed={source === 'video'} disabled={busy} onClick={() => setSource('video')}>
                  {t('voiceSourceVideo')}
                </button>
                <button type="button" className={studio.mode} aria-pressed={source === 'avatar'} disabled={busy} onClick={() => setSource('avatar')}>
                  {t('voiceSourceAvatar')}
                </button>
              </div>

              {source === 'video' ? (
                <>
                  <label className={studio.buttonSecondary} htmlFor="voice-video" aria-disabled={busy || undefined}>
                    {speech ? t('voiceVideoReplace') : t('voiceVideoUpload')}
                  </label>
                  <input
                    id="voice-video"
                    className="visually-hidden"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void uploadSpeech(file);
                    }}
                  />
                  <p className={studio.hint} role="status">
                    {speechState === 'uploading'
                      ? t('voiceVideoUploading')
                      : speechState === 'failed'
                        ? t('voiceVideoFailed')
                        : speech
                          ? t('voiceVideoReady', { s: Math.round(speech.duration_s) })
                          : t('voiceVideoHint')}
                  </p>
                  {speech && (
                    <>
                      <video className={styles.preview} src={speech.url} controls playsInline preload="metadata" />
                      <ConsentCheck id="voice-rights" checked={rights} onChange={setRights} label="voiceRights" />
                    </>
                  )}
                </>
              ) : avatars.length === 0 ? (
                <p className={studio.hint}>{t('voiceNoAvatar')}</p>
              ) : (
                <>
                  <select
                    className={studio.composeSelect}
                    aria-label={t('voiceAvatarPick')}
                    value={avatarId ?? ''}
                    disabled={busy}
                    onChange={(event) => setAvatarId(event.target.value || null)}
                  >
                    <option value="">{t('voiceAvatarPick')}</option>
                    {avatars.map((item) => (
                      <option key={item.key} value={jobIdOf(item)}>
                        {item.name} · {new Date(item.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  {avatar && <video className={styles.preview} src={avatar.previewUrl} controls playsInline preload="metadata" />}
                </>
              )}

              <span className={studio.sectionTitle}>{t('voiceSampleTitle')}</span>
              <label className={studio.buttonSecondary} htmlFor="voice-sample" aria-disabled={busy || undefined}>
                {sample ? t('voiceReplace') : t('voiceUpload')}
              </label>
              <input
                id="voice-sample"
                className="visually-hidden"
                type="file"
                accept="audio/*"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadSample(file);
                }}
              />
              <p className={studio.hint} role="status">
                {sampleState === 'uploading'
                  ? t('voiceUploading')
                  : sampleState === 'failed'
                    ? t('voiceFailed')
                    : sample
                      ? t('voiceReady', { s: Math.round(sample.duration_s) })
                      : t('voiceSampleHint')}
              </p>
              {sample && <ConsentCheck id="voice-consent" checked={consent} onChange={setConsent} label="voiceConsent" />}

              <button type="button" className={studio.buttonPrimary} disabled={!canStart} onClick={make}>
                {t('voiceChangeMake', { d: formatDuration(info?.estimates.voiceChange ?? 0) })}
              </button>
              {!canStart && !busy && <p className={studio.hint}>{t('voiceChangeNeeds')}</p>}
            </section>

            <section className={page.result} aria-labelledby="voice-result" aria-live="polite">
              <h2 id="voice-result" className={studio.sectionTitle}>
                {t('voiceChangeResult')}
              </h2>
              {busy && job && (
                <div className={studio.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
                  <span className={studio.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
                </div>
              )}
              {(refusal || failed) && (
                <p className={studio.photoError} role="alert">
                  {refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}
                </p>
              )}
              {done ? (
                <>
                  <video className={styles.video} src={done.outputUrl} controls playsInline />
                  <a className={studio.buttonSecondary} href={done.outputUrl} download="montagio-voice.mp4">
                    {t('voiceChangeDownload')}
                  </a>
                  <p className={studio.hint}>{t('adCaption')}</p>
                </>
              ) : (
                !busy && <p className={styles.empty}>{t('voiceChangeEmpty')}</p>
              )}
            </section>
          </div>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
