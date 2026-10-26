'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { CharacterSummary, HistoryItem, RemixMode, UploadResult } from '@/lib/api-types';
import { facePhoto, faceSubject, STARTING_FACES, type BankFace } from '@/lib/character-bank';
import { formatDuration } from '@/lib/duration';
import { MAX_VIDEO_BYTES } from '@/lib/limits';
import { refusalMessageKey } from '@/lib/refusals';
import { useExtensions } from '@/lib/use-extensions';
import { useJob } from '@/lib/use-job';
import { ConsentCheck } from './ConsentCheck';
import { FacePicker } from './FacePicker';
import { FeatureExamples, useFeatureExamples } from './FeatureExamples';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import page from './ads.module.css';
import styles from './remix.module.css';
import studio from './studio.module.css';

type Point = { x: number; y: number };
type Shot = { start: number; end: number; thumbUrl: string };
/** A trend as the server prepared it (POST /api/uploads/remix, /sample, /api/remix/import, /api/remix/shots). */
type Trend = {
  remixRef: string;
  duration_s: number;
  fps: number;
  frames: number;
  width: number;
  height: number;
  audio: boolean;
  origin: 'upload' | 'link' | 'sample';
  link?: { url: string; host: string };
  sound?: { title: string; artists: string[]; searchUrl: string };
  cuts: number[];
  url: string;
  shots: Shot[];
};
type Choice = { keep: boolean; points: Point[] };
type Photo = { imageRef: string; personal: boolean; url: string };
type Skeleton = { skeleton: { shots: string[]; hook: string; style: string }; post: { caption: string; hashtags: string[]; onscreen: string } };
type Source = 'file' | 'link' | 'sample';
/** The link field: shown only in the app on a machine of its own; disabled while yt-dlp is missing. */
type LinkImport = 'absent' | 'available' | 'unavailable';

/** The most cuts a remix takes (16 shots), and the points marking an object on a shot. */
const MAX_CUTS = 15;
const MAX_POINTS = 8;
const CHARACTER_MAX = 200;
const ONSCREEN_MAX = 120;
const CAPTION_MAX = 2200;
/** A cut moves by a fifth of a second. */
const CUT_STEP_S = 0.2;
const PLATFORMS: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', 'youtu.be': 'YouTube' };

const platformOf = (host: string | undefined) => Object.entries(PLATFORMS).find(([key]) => host?.includes(key))?.[1] ?? 'TikTok';
const freshChoices = (count: number): Choice[] => Array.from({ length: count }, () => ({ keep: false, points: [] }));
const hashtagsOf = (text: string) => [...new Set(text.split(/[\s,]+/).map((tag) => tag.replace(/^#+/, '')).filter(Boolean))].slice(0, 8);
const seconds = (frame: number, fps: number) => (frame / fps).toFixed(1);

/**
 * The trend remix: a short video the user may use (a file, a link fetched on this machine, or the
 * sample), cut into its shots, each made again with the user's character (or with one object
 * replaced), put back on the same frames and cut to 9:16; Gemma 4 E4B, on this machine, drafts the
 * post. Nothing is published: the user posts it.
 */
export function RemixPage() {
  const { t, lang } = useI18n();
  const info = useExtensions();
  // The showcase shows the remixes Montagio rendered of its own trend.
  const examples = useFeatureExamples();
  const remix = useJob();
  const reading = useJob();
  const [source, setSource] = useState<Source>('file');
  const [trend, setTrend] = useState<Trend | null>(null);
  const [cuts, setCuts] = useState<number[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [loading, setLoading] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [linkImport, setLinkImport] = useState<LinkImport>('absent');
  const [link, setLink] = useState('');
  const [rights, setRights] = useState(false);
  const [mode, setMode] = useState<RemixMode>('motion');
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [photoSource, setPhotoSource] = useState<'mine' | 'photo' | 'sample' | 'face'>('mine');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [faceConsent, setFaceConsent] = useState(false);
  const [character, setCharacter] = useState('');
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState<'en' | 'fr'>(lang === 'fr' ? 'fr' : 'en');
  const [skeleton, setSkeleton] = useState<Skeleton['skeleton'] | null>(null);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [onscreen, setOnscreen] = useState('');
  const [copied, setCopied] = useState(false);
  const [keepSound, setKeepSound] = useState(false);
  const [soundRights, setSoundRights] = useState(false);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const restored = useRef(false);
  const shotsRequest = useRef(0);

  const available = Boolean(info?.extensions.includes('remix'));
  const busy = remix.busy || loading === 'busy';

  useEffect(() => {
    if (IS_SHOWCASE || !available) return;
    // The link field exists only where the server answers for it: never in the demo.
    apiFetch('/api/remix/import')
      .then(async (res) => (res.ok ? setLinkImport(((await res.json()) as { available: boolean }).available ? 'available' : 'unavailable') : setLinkImport('absent')))
      .catch(() => setLinkImport('absent'));
  }, [available]);

  useEffect(() => {
    if (IS_SHOWCASE || !available || characters !== null) return;
    apiFetch('/api/characters')
      .then((res) => jsonOrThrow<CharacterSummary[]>(res))
      .then(setCharacters)
      .catch(() => setCharacters([]));
  }, [available, characters]);

  /** A trend the server just prepared: its shots as found, nothing kept, no point yet. */
  const takeTrend = (next: Trend, keep?: { cuts: number[]; choices?: Choice[] }) => {
    setTrend(next);
    setCuts(keep?.cuts ?? next.cuts);
    setShots(next.shots);
    setChoices(keep?.choices && keep.choices.length === next.shots.length ? keep.choices : freshChoices(next.shots.length));
    setSkeleton(null);
    setKeepSound(false);
    setSoundRights(false);
    remix.reset();
  };

  const prepare = async (request: Promise<Response>) => {
    setLoading('busy');
    setRefusal(null);
    const res = await request.catch(() => null);
    if (!res?.ok) {
      const code = res ? (((await res.json().catch(() => ({}))) as { error?: string }).error ?? null) : null;
      setRefusal(code);
      setLoading('failed');
      return;
    }
    takeTrend((await res.json()) as Trend);
    setLoading('idle');
  };

  const sendFile = (file: File) => {
    setTrend(null);
    // The rights box is ticked for this video, not carried over from another one.
    setRights(false);
    if (file.size > MAX_VIDEO_BYTES) return setLoading('failed');
    const form = new FormData();
    form.append('video', file);
    void prepare(apiFetch('/api/uploads/remix', { method: 'POST', body: form }));
  };

  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const takeSample = () => void prepare(apiFetch('/api/uploads/remix/sample', json({})));
  const importLink = () => void prepare(apiFetch('/api/remix/import', json({ url: link.trim(), rights })));

  /** The cuts moved: the server cuts the shots again and draws their first frames. */
  const recut = async (next: number[]) => {
    if (!trend) return;
    const sorted = [...new Set(next)].sort((a, b) => a - b);
    setCuts(sorted);
    setChoices(freshChoices(sorted.length + 1));
    const ticket = ++shotsRequest.current;
    const res = await apiFetch('/api/remix/shots', json({ remixRef: trend.remixRef, cuts: sorted })).catch(() => null);
    if (ticket !== shotsRequest.current || !res?.ok) return;
    setShots(((await res.json()) as Trend).shots);
  };

  const step = trend ? Math.max(1, Math.round(trend.fps * CUT_STEP_S)) : 1;
  const moveCut = (index: number, by: number) => {
    const low = (cuts[index - 1] ?? 0) + 1;
    const high = (cuts[index + 1] ?? trend!.frames) - 1;
    const moved = Math.min(high, Math.max(low, cuts[index]! + by));
    if (moved !== cuts[index]) void recut(cuts.map((cut, n) => (n === index ? moved : cut)));
  };
  const removeCut = (index: number) => void recut(cuts.filter((_, n) => n !== index));
  const splitShot = (shot: Shot) => {
    const middle = Math.floor((shot.start + shot.end) / 2);
    if (middle > shot.start && cuts.length < MAX_CUTS) void recut([...cuts, middle]);
  };

  const choose = (index: number, change: (choice: Choice) => Choice) => setChoices((list) => list.map((choice, n) => (n === index ? change(choice) : choice)));
  const mark = (index: number, event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // A click from the keyboard has no position: the centre of the frame.
    const point = event.detail === 0 ? { x: 0.5, y: 0.5 } : { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    const clamp = (value: number) => Math.min(1, Math.max(0, Number(value.toFixed(4))));
    choose(index, (choice) => (choice.points.length >= MAX_POINTS ? choice : { ...choice, points: [...choice.points, { x: clamp(point.x), y: clamp(point.y) }] }));
  };

  const setPhotoFrom = (next: Photo | null) => {
    setPhoto(next);
    // The face box is ticked for each photo: never carried over to another one.
    setFaceConsent(false);
    setPhotoFailed(false);
  };
  const sendPhoto = async (file: File) => {
    const form = new FormData();
    form.append('image', file);
    const res = await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return setPhotoFailed(true);
    const meta = (await res.json()) as { imageRef: string; personal?: boolean };
    setPhotoFrom({ imageRef: meta.imageRef, personal: meta.personal ?? true, url: `/media/data/${meta.imageRef}` });
  };
  const takeSamplePhoto = async () => {
    const res = await apiFetch('/api/uploads/sample?for=motion', { method: 'POST' }).catch(() => null);
    if (!res?.ok) return setPhotoFailed(true);
    const meta = (await res.json()) as { imageRef: string };
    setPhotoFrom({ imageRef: meta.imageRef, personal: false, url: `/media/data/${meta.imageRef}` });
  };
  /** A starting face, copied by the server like the example: the character of the remix, already described. */
  const pickFace = async (face: BankFace) => {
    const res = await apiFetch(`/api/uploads/face?id=${encodeURIComponent(face.id)}`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) return setPhotoFailed(true);
    const meta = (await res.json()) as UploadResult;
    setPhotoFrom({ imageRef: meta.imageRef, personal: false, url: facePhoto(face.id) });
    setCharacter(faceSubject(face).slice(0, CHARACTER_MAX));
  };
  const pickCharacter = (id: string) => {
    const picked = characters?.find((entry) => entry.id === id);
    if (!picked) return setPhotoFrom(null);
    setPhotoFrom({ imageRef: picked.imageRef, personal: false, url: picked.imageUrl });
    setCharacter(picked.description.slice(0, CHARACTER_MAX));
  };

  // Gemma's skeleton, once read: the post's fields take its draft.
  const readJob = reading.job;
  useEffect(() => {
    if (readJob?.state !== 'succeeded' || !readJob.outputUrl) return;
    let alive = true;
    apiFetch(readJob.outputUrl)
      .then((res) => jsonOrThrow<Skeleton>(res))
      .then((doc) => {
        if (!alive) return;
        setSkeleton(doc.skeleton);
        setCaption(doc.post.caption);
        setHashtags(doc.post.hashtags.map((tag) => `#${tag}`).join(' '));
        setOnscreen(doc.post.onscreen.slice(0, ONSCREEN_MAX));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [readJob?.state, readJob?.outputUrl]);

  // Reuse or Reproduce from the history: /remix?from=job:<id>[&reproduce=1].
  useEffect(() => {
    if (IS_SHOWCASE || !available || restored.current) return;
    const query = new URLSearchParams(window.location.search);
    const from = query.get('from');
    if (!from) return;
    restored.current = true;
    void (async () => {
      const items = await apiFetch('/api/history').then((res) => jsonOrThrow<HistoryItem[]>(res)).catch(() => [] as HistoryItem[]);
      const item = items.find((entry) => entry.key === from);
      const choices = item?.reprise.remix;
      if (!item || !choices) return;
      setMode(choices.mode === 'scene' && info?.remix?.scene ? 'scene' : 'motion');
      setCharacter(choices.character ?? '');
      setPrompt(choices.prompt ?? '');
      setOnscreen(choices.onscreen ?? '');
      setLanguage(choices.language);
      setCaption(choices.post?.caption ?? '');
      setHashtags((choices.post?.hashtags ?? []).map((tag) => `#${tag}`).join(' '));
      if (item.reprise.imageRef) setPhotoFrom({ imageRef: item.reprise.imageRef, personal: item.reprise.personal ?? true, url: `/media/data/${item.reprise.imageRef}` });
      if (query.get('reproduce') === '1') setSeed(item.reprise.seed);
      if (!item.reprise.remixRef) return;
      // The trend is still here: its cuts and the choice of each shot come back.
      const res = await apiFetch('/api/remix/shots', json({ remixRef: item.reprise.remixRef, cuts: choices.cuts })).catch(() => null);
      if (!res?.ok) return;
      const back = (await res.json()) as Trend;
      setSource(back.origin === 'link' ? 'link' : back.origin === 'sample' ? 'sample' : 'file');
      takeTrend(back, { cuts: choices.cuts, choices: choices.shots.map((shot) => ({ keep: shot.keep, points: shot.points ?? [] })) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page can show the remix
  }, [available]);

  const scene = mode === 'scene';
  const made = choices.filter((choice) => !choice.keep);
  const needsRights = trend !== null && !(trend.origin === 'sample' && !photo?.personal);
  const ready =
    trend !== null &&
    choices.length === shots.length &&
    made.length > 0 &&
    (scene ? prompt.trim().length > 0 && made.every((choice) => choice.points.length > 0) : photo !== null) &&
    (!photo || faceConsent) &&
    (!needsRights || rights) &&
    (!keepSound || soundRights);
  const canStart = available && ready && !busy;
  const perShot = (scene ? info?.estimates.swap : info?.estimates.motion) ?? 0;
  const done = remix.job?.state === 'succeeded' && remix.job.outputUrl ? remix.job : null;
  const failed = remix.job?.state === 'failed' || remix.job?.state === 'canceled';
  const percent = remix.job ? Math.round(remix.job.progress * 100) : 0;
  const tags = hashtagsOf(hashtags);
  const post = [caption.trim(), tags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');

  const make = () => {
    if (!canStart || !trend) return;
    void remix.start('/api/remix', {
      remixRef: trend.remixRef,
      cuts,
      mode,
      shots: choices.map((choice) => (choice.keep ? { keep: true } : scene ? { keep: false, points: choice.points } : { keep: false })),
      ...(photo ? { imageRef: photo.imageRef, faceConsent } : {}),
      rights,
      ...(character.trim() && !scene ? { character: character.trim() } : {}),
      ...(scene ? { prompt: prompt.trim() } : {}),
      ...(onscreen.trim() ? { onscreen: onscreen.trim() } : {}),
      language,
      ...(caption.trim() || tags.length > 0 ? { post: { caption: caption.trim(), hashtags: tags } } : {}),
      keepSound,
      ...(keepSound ? { soundRights } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  };

  const readTrend = () => {
    if (!trend || reading.busy) return;
    void reading.start('/api/remix/skeleton', { remixRef: trend.remixRef, cuts, language, ...(character.trim() && !scene ? { character: character.trim() } : {}) });
  };

  const copyPost = async () => {
    await navigator.clipboard?.writeText(post).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const soundLink = trend?.sound && (
    <a className={studio.buttonSecondary} href={trend.sound.searchUrl} target="_blank" rel="noopener noreferrer">
      {t('trendSoundSearch', { platform: platformOf(trend.link?.host) })}
    </a>
  );

  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className={page.page}>
        <div className={page.intro}>
          <h1 className={page.title}>{t('trendTitle')}</h1>
          <p className={page.lead}>{t('trendLead')}</p>
        </div>
        {IS_SHOWCASE ? (
          <>
            <p className={studio.hint}>{t('trendShowcase')}</p>
            <FeatureExamples kinds={['remix']} examples={examples} />
          </>
        ) : !available ? (
          <p className={studio.hint}>{t('trendNeedsExtension')}</p>
        ) : (
          <div className={page.layout}>
            <section className={page.panel} aria-labelledby="trend-setup">
              <h2 id="trend-setup" className={page.panelTitle}>
                {t('trendSourceTitle')}
              </h2>
              <div className={studio.canvasViews} role="group" aria-label={t('trendSourceTitle')}>
                <button type="button" className={studio.mode} aria-pressed={source === 'file'} disabled={busy} onClick={() => setSource('file')}>
                  {t('trendSourceFile')}
                </button>
                {linkImport !== 'absent' && (
                  <button type="button" className={studio.mode} aria-pressed={source === 'link'} disabled={busy} onClick={() => setSource('link')}>
                    {t('trendSourceLink')}
                  </button>
                )}
                <button type="button" className={studio.mode} aria-pressed={source === 'sample'} disabled={busy} onClick={() => setSource('sample')}>
                  {t('trendSourceSample')}
                </button>
              </div>

              {source === 'file' && (
                <>
                  <label className={studio.buttonSecondary} htmlFor="trend-video" aria-disabled={busy || undefined}>
                    {trend?.origin === 'upload' ? t('trendReplace') : t('trendUpload')}
                  </label>
                  <input
                    id="trend-video"
                    className="visually-hidden"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) sendFile(file);
                    }}
                  />
                  <p className={studio.hint}>{t('trendUploadHint')}</p>
                </>
              )}
              {source === 'link' && (
                <>
                  <label className={styles.field} htmlFor="trend-link">
                    {t('trendLinkLabel')}
                    <input
                      id="trend-link"
                      className={studio.prompt}
                      type="url"
                      inputMode="url"
                      maxLength={500}
                      placeholder="https://www.tiktok.com/@…/video/…"
                      value={link}
                      disabled={busy || linkImport === 'unavailable'}
                      onChange={(event) => setLink(event.target.value)}
                    />
                  </label>
                  {linkImport === 'unavailable' ? (
                    <p className={studio.hint}>{t('trendLinkUnavailable')}</p>
                  ) : (
                    <>
                      {/* Before anything is fetched; once a trend is here, the box below says the same. */}
                      {!trend && <ConsentCheck id="trend-link-rights" checked={rights} onChange={setRights} label="trendLinkRights" />}
                      <button type="button" className={studio.buttonSecondary} disabled={busy || !rights || !link.trim()} onClick={importLink}>
                        {t('trendLinkImport')}
                      </button>
                      <p className={studio.hint}>{t('trendLinkHint')}</p>
                    </>
                  )}
                </>
              )}
              {source === 'sample' && (
                <>
                  <button type="button" className={studio.buttonSecondary} disabled={busy} onClick={takeSample}>
                    {t('trendSampleUse')}
                  </button>
                  <p className={studio.hint}>{t('trendSampleHint')}</p>
                </>
              )}
              <p className={studio.hint} role="status">
                {loading === 'busy' ? t(source === 'link' ? 'trendLinkImporting' : 'trendUploading') : ''}
              </p>
              {loading === 'failed' && (
                <p className={studio.photoError} role="alert">
                  {refusal ? t(refusalMessageKey(refusal)) : t('trendUploadFailed')}
                </p>
              )}

              {trend && (
                <>
                  <video className={styles.preview} src={trend.url} controls playsInline preload="metadata" />
                  <p className={styles.facts}>
                    {t('trendFacts', { s: trend.duration_s.toFixed(1), fps: trend.fps, n: shots.length })}
                    {trend.link && <> · {t('trendLinkFrom', { host: trend.link.host })}</>}
                  </p>
                  {trend.link && (
                    <p className={styles.small}>
                      <a href={trend.link.url} target="_blank" rel="noopener noreferrer">
                        {trend.link.url}
                      </a>
                    </p>
                  )}

                  <h2 className={studio.sectionTitle}>{t('trendShotsTitle')}</h2>
                  <p className={studio.hint}>{scene ? t('trendPointsHint') : t('trendShotsHint')}</p>
                  <ol className={styles.shots}>
                    {shots.map((shot, index) => {
                      const choice = choices[index] ?? { keep: false, points: [] };
                      const marking = scene && !choice.keep;
                      return (
                        <li key={`${shot.start}-${shot.end}`} className={styles.shot} data-keep={choice.keep}>
                          <div className={styles.shotHead}>
                            <span>{t('trendShot', { n: index + 1 })}</span>
                            <span className={styles.shotTime}>{t('trendShotTime', { a: seconds(shot.start, trend.fps), b: seconds(shot.end, trend.fps) })}</span>
                          </div>
                          <button
                            type="button"
                            className={styles.thumbButton}
                            data-marking={marking}
                            disabled={!marking || busy}
                            aria-label={marking ? t('trendPointsHint') : t('trendShot', { n: index + 1 })}
                            onClick={(event) => mark(index, event)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a frame of the user's own video, served by the app */}
                            <img className={styles.thumb} src={shot.thumbUrl} alt="" style={{ aspectRatio: `${trend.width} / ${trend.height}` }} />
                            {marking && choice.points.map((point, n) => <span key={n} className={styles.point} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />)}
                          </button>
                          <ConsentCheck id={`trend-keep-${index}`} checked={choice.keep} onChange={(keep) => choose(index, (current) => ({ ...current, keep }))} label="trendKeep" />
                          {marking && choice.points.length > 0 && (
                            <button type="button" className={styles.cutButton} disabled={busy} onClick={() => choose(index, (current) => ({ ...current, points: [] }))}>
                              {t('trendPointsClear')} ({choice.points.length})
                            </button>
                          )}
                          <div className={styles.cut}>
                            {index > 0 && (
                              <>
                                <button type="button" className={styles.cutButton} aria-label={t('trendCutEarlier')} title={t('trendCutEarlier')} disabled={busy} onClick={() => moveCut(index - 1, -step)}>
                                  ◀
                                </button>
                                <button type="button" className={styles.cutButton} aria-label={t('trendCutLater')} title={t('trendCutLater')} disabled={busy} onClick={() => moveCut(index - 1, step)}>
                                  ▶
                                </button>
                                <button type="button" className={styles.cutButton} aria-label={t('trendCutRemove')} title={t('trendCutRemove')} disabled={busy} onClick={() => removeCut(index - 1)}>
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                          <button type="button" className={styles.cutButton} disabled={busy || cuts.length >= MAX_CUTS || shot.end - shot.start < 2} onClick={() => splitShot(shot)}>
                            {t('trendSplit')}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}

              <h2 className={studio.sectionTitle}>{t('trendModeTitle')}</h2>
              <div className={studio.canvasViews} role="group" aria-label={t('trendModeTitle')}>
                <button type="button" className={studio.mode} aria-pressed={!scene} disabled={busy} onClick={() => setMode('motion')}>
                  {t('trendModeMotion')}
                </button>
                {info?.remix?.scene && (
                  <button type="button" className={studio.mode} aria-pressed={scene} disabled={busy} onClick={() => setMode('scene')}>
                    {t('trendModeScene')}
                  </button>
                )}
              </div>

              <span className={studio.sectionTitle}>{t(scene ? 'trendObjectTitle' : 'trendCharacterTitle')}</span>
              {scene && (
                <label className={styles.field} htmlFor="trend-prompt">
                  {t('trendScenePrompt')}
                  <input id="trend-prompt" className={studio.prompt} maxLength={500} value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} />
                </label>
              )}
              <div className={styles.row} role="group" aria-label={t(scene ? 'trendPhotoOptional' : 'trendCharacterTitle')}>
                {!scene && (
                  <button type="button" className={studio.chip} aria-pressed={photoSource === 'mine'} disabled={busy} onClick={() => setPhotoSource('mine')}>
                    {t('trendCharacterMine')}
                  </button>
                )}
                <button type="button" className={studio.chip} aria-pressed={photoSource === 'photo' || (scene && photoSource === 'mine')} disabled={busy} onClick={() => setPhotoSource('photo')}>
                  {t('trendCharacterPhoto')}
                </button>
                {!scene && (
                  <button type="button" className={studio.chip} aria-pressed={photoSource === 'sample'} disabled={busy} onClick={() => setPhotoSource('sample')}>
                    {t('trendCharacterSample')}
                  </button>
                )}
                {!scene && STARTING_FACES.length > 0 && (
                  <button type="button" className={studio.chip} aria-pressed={photoSource === 'face'} disabled={busy} onClick={() => setPhotoSource('face')}>
                    {t('trendCharacterFace')}
                  </button>
                )}
              </div>
              {photoSource === 'mine' && !scene ? (
                characters && characters.length === 0 ? (
                  <p className={studio.hint}>{t('trendNoCharacter')}</p>
                ) : (
                  <select className={studio.composeSelect} aria-label={t('trendCharacterPick')} disabled={busy} defaultValue="" onChange={(event) => pickCharacter(event.target.value)}>
                    <option value="">{t('trendCharacterPick')}</option>
                    {(characters ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                )
              ) : photoSource === 'face' && !scene ? (
                <FacePicker
                  faces={STARTING_FACES}
                  selectedId={STARTING_FACES.find((face) => facePhoto(face.id) === photo?.url)?.id ?? null}
                  disabled={busy}
                  onPick={(face) => void pickFace(face)}
                />
              ) : photoSource === 'sample' && !scene ? (
                <button type="button" className={studio.buttonSecondary} disabled={busy} onClick={() => void takeSamplePhoto()}>
                  {t('trendSampleUse')}
                </button>
              ) : (
                <>
                  <label className={studio.buttonSecondary} htmlFor="trend-photo" aria-disabled={busy || undefined}>
                    {scene ? t('trendPhotoOptional') : t('trendPhotoUpload')}
                  </label>
                  <input
                    id="trend-photo"
                    className="visually-hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void sendPhoto(file);
                    }}
                  />
                </>
              )}
              {photoFailed && (
                <p className={studio.photoError} role="alert">
                  {t('trendPhotoFailed')}
                </p>
              )}
              {photo && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, served by the app */}
                  <img className={styles.photo} src={photo.url} alt="" />
                  <ConsentCheck id="trend-face" checked={faceConsent} onChange={setFaceConsent} label="trendFaceConsent" />
                </>
              )}
              {!scene && (
                <label className={styles.field} htmlFor="trend-character">
                  {t('trendDescribe')}
                  <textarea id="trend-character" className={studio.prompt} rows={2} maxLength={CHARACTER_MAX} value={character} disabled={busy} onChange={(event) => setCharacter(event.target.value)} />
                </label>
              )}

              <h2 className={studio.sectionTitle}>{t('trendPostTitle')}</h2>
              <div className={styles.row} role="radiogroup" aria-label={t('trendLanguage')}>
                {(['en', 'fr'] as const).map((value) => (
                  <button key={value} type="button" role="radio" lang={value} className={studio.chip} aria-checked={language === value} disabled={busy} onClick={() => setLanguage(value)}>
                    {value === 'en' ? 'English' : 'Français'}
                  </button>
                ))}
              </div>
              {info?.remix?.skeleton && trend && (
                <>
                  <button type="button" className={studio.buttonSecondary} disabled={busy || reading.busy} onClick={readTrend}>
                    {reading.busy ? t('trendSkeletonReading') : t('trendSkeletonRead', { d: formatDuration(info.remix.skeleton.estimate_s) })}
                  </button>
                  <p className={studio.hint}>{t('trendSkeletonLocal')}</p>
                </>
              )}
              {(reading.refusal || reading.job?.state === 'failed') && (
                <p className={studio.photoError} role="alert">
                  {t('trendSkeletonFailed')}
                </p>
              )}
              {skeleton && skeleton.shots.length > 0 && (
                <>
                  <span className={styles.small}>{t('trendSkeletonSeen')}</span>
                  <ol className={styles.seen}>
                    {skeleton.shots.map((line, n) => (
                      <li key={n}>{line}</li>
                    ))}
                  </ol>
                  {skeleton.style && <p className={styles.small}>{t('trendSkeletonStyle', { style: skeleton.style })}</p>}
                </>
              )}
              <label className={styles.field} htmlFor="trend-caption">
                {t('trendCaption')}
                <textarea id="trend-caption" className={studio.prompt} rows={3} maxLength={CAPTION_MAX} value={caption} disabled={busy} onChange={(event) => setCaption(event.target.value)} />
              </label>
              <label className={styles.field} htmlFor="trend-hashtags">
                {t('trendHashtags')}
                <input id="trend-hashtags" className={studio.prompt} maxLength={300} value={hashtags} disabled={busy} onChange={(event) => setHashtags(event.target.value)} />
              </label>
              <label className={styles.field} htmlFor="trend-onscreen">
                {t('trendOnscreen')}
                <input id="trend-onscreen" className={studio.prompt} maxLength={ONSCREEN_MAX} value={onscreen} disabled={busy} onChange={(event) => setOnscreen(event.target.value)} />
              </label>

              {trend && (
                <>
                  <h2 className={studio.sectionTitle}>{t('trendSoundTitle')}</h2>
                  {trend.sound && <p className={styles.small}>{t('trendSoundOf', { title: [trend.sound.title, ...trend.sound.artists].join(' · ') })}</p>}
                  {trend.audio ? (
                    <>
                      <p className={studio.hint}>{t('trendSoundDefault')}</p>
                      <ConsentCheck id="trend-keep-sound" checked={keepSound} onChange={setKeepSound} label="trendKeepSound" />
                      {keepSound && <ConsentCheck id="trend-sound-rights" checked={soundRights} onChange={setSoundRights} label="trendSoundRights" />}
                    </>
                  ) : (
                    <p className={studio.hint}>{t('trendNoSound')}</p>
                  )}
                  {soundLink}
                </>
              )}

              {needsRights && <ConsentCheck id="trend-rights" checked={rights} onChange={setRights} label="trendRights" />}
              <button type="button" className={studio.buttonPrimary} disabled={!canStart} onClick={make}>
                {trend ? t('trendMake', { n: made.length, d: formatDuration(perShot * Math.max(1, made.length)) }) : t('trendTitle')}
              </button>
              {!canStart && !busy && <p className={studio.hint}>{t('trendNeeds')}</p>}
            </section>

            <section className={page.result} aria-labelledby="trend-result" aria-live="polite">
              <h2 id="trend-result" className={studio.sectionTitle}>
                {t('trendResult')}
              </h2>
              {remix.busy && remix.job && (
                <div className={studio.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
                  <span className={studio.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
                </div>
              )}
              {(remix.refusal || failed) && (
                <p className={studio.photoError} role="alert">
                  {remix.refusal ? t(refusalMessageKey(remix.refusal)) : t('failed', { error: remix.job?.error ?? '?' })}
                </p>
              )}
              {done ? (
                <>
                  <video className={page.video} src={done.verticalUrl ?? done.outputUrl} controls playsInline />
                  <div className={styles.row}>
                    <a className={studio.buttonPrimary} href={done.verticalUrl ?? done.outputUrl} download="montagio-remix-9x16.mp4">
                      {t('trendDownload')}
                    </a>
                    <a className={studio.buttonSecondary} href={done.outputUrl} download="montagio-remix.mp4">
                      {t('trendDownloadOriginal')}
                    </a>
                  </div>
                  {post && (
                    <div className={styles.post}>
                      <span>{post}</span>
                      <button type="button" className={studio.buttonSecondary} onClick={() => void copyPost()}>
                        {copied ? t('trendCopied') : t('trendCopy')}
                      </button>
                    </div>
                  )}
                  {soundLink}
                  <p className={studio.hint}>{t('adCaption')}</p>
                </>
              ) : (
                !remix.busy && <p className={page.empty}>{t('trendEmpty')}</p>
              )}
            </section>
          </div>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
