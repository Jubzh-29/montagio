'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import {
  TERMINAL_STATES,
  type GenerationRecord,
  type JobState,
  type ModelSummary,
  type PresetSummary,
  type SampleSummary,
  type SequenceSummary,
  type UploadResult,
} from '@/lib/api-types';
import { refusalMessageKey } from '@/lib/refusals';
import { presetTextUrl, resultRemixAction } from '@/lib/remix';
import { primaryLabelKey, showcaseNoteKeys, studioCapabilities } from '@/lib/showcase-ui';
import { useShowcase } from '@/lib/use-showcase';
import { Header } from './Header';
import { ModelPicker } from './ModelPicker';
import { Monitor, type GenerationState, type TrackedJob, type UploadState } from './Monitor';
import { PresetGallery } from './PresetGallery';
import { RemixEditor, type RemixCheck } from './RemixEditor';
import { ShotList } from './ShotList';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './studio.module.css';

const POLL_MS = 1000;
const MAX_POLL_FAILURES = 4;
const MAX_SHOTS = 3;
const ASSEMBLY_ESTIMATE_S = 5;

type Mode = 'single' | 'sequence';

/** A shot being composed: its camera move and its own optional text. */
type ShotDraft = { presetId: string; prompt: string };

/** A render in progress or finished: a single generation or a sequence of shots. */
type Job =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'tracking'; kind: 'generation'; record: GenerationRecord }
  | { status: 'tracking'; kind: 'sequence'; record: SequenceSummary }
  | { status: 'error'; message: string };

type Tracked = Extract<Job, { status: 'tracking' }>;

/** The body of a refused request. */
type Refusal = { error?: string; problems?: string[] };

/** A preset being remixed: the text it was opened with and the edited text. */
type Remix = {
  baseId: string;
  baseName: string;
  original: string;
  text: string;
  /** The generation whose preset this editor holds: the remix it was opened from, or the last one it rendered. */
  generationId?: string;
  check?: RemixCheck;
  /** The model a server answer was for; absent for an answer that depends on none. */
  checkModel?: string | null;
};

const SEQUENCE_STATE: Record<SequenceSummary['state'], JobState> = {
  running: 'running',
  assembling: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
};

function trackedJob(job: Tracked): TrackedJob {
  if (job.kind === 'generation') return job.record;
  const { id, progress, outputUrl, error } = job.record;
  return { id, progress, outputUrl, error, state: SEQUENCE_STATE[job.record.state] };
}

const endpoint = (job: Tracked) => `/api/${job.kind === 'sequence' ? 'sequences' : 'generations'}/${job.record.id}`;

/** The same job, marked as lost by the server (404). */
function lostJob(job: Tracked): Job {
  return job.kind === 'generation'
    ? { ...job, record: { ...job.record, state: 'failed', error: 'lost' } }
    : { ...job, record: { ...job.record, state: 'failed', error: 'lost' } };
}

export function Studio() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('single');
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [job, setJob] = useState<Job>({ status: 'idle' });
  const submitting = useRef(false);
  const pollFailures = useRef(0);
  const [pollRetry, setPollRetry] = useState(0);
  const localUrlRef = useRef<string | undefined>(undefined);
  const [remix, setRemix] = useState<Remix | null>(null);
  const remixTextRef = useRef<HTMLTextAreaElement>(null);
  const remixToggleRef = useRef<HTMLButtonElement>(null);
  const remixFocus = useRef<'editor' | 'toggle' | null>(null);
  // The showcase: sample photos and pre-generated clips. Uploads and remix renders
  // follow its capabilities (none in the static showcase).
  const showcase = useShowcase();
  const capabilities = studioCapabilities(IS_SHOWCASE, showcase);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/presets').then((res) => jsonOrThrow<PresetSummary[]>(res)),
      apiFetch('/api/models').then((res) => jsonOrThrow<ModelSummary[]>(res)),
    ])
      .then(([presetList, modelList]) => {
        setPresets(presetList);
        setModels(modelList.filter((model) => model.kind === 'video'));
        setPresetId((current) => current ?? presetList[0]?.id ?? null);
        setModelId((current) => current ?? presetList[0]?.defaultModel ?? null);
      })
      .catch(() => setJob({ status: 'error', message: t('errorGeneric') }));
    // t only changes with the language; the catalog is fetched once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  // The editor takes the gallery's place: move the focus with it, and back on close.
  // remixFocus is set just before the setRemix that opens, refills or closes the editor.
  useEffect(() => {
    if (remixFocus.current === 'editor') remixTextRef.current?.focus();
    if (remixFocus.current === 'toggle') remixToggleRef.current?.focus();
    remixFocus.current = null;
  }, [remix]);

  const tracked = job.status === 'tracking' ? job : undefined;
  const view = tracked ? trackedJob(tracked) : undefined;
  const busy = job.status === 'submitting' || (view !== undefined && !TERMINAL_STATES.has(view.state));

  // Poll the current job until it reaches a terminal state. A 404 means the
  // server lost it (data wiped, restart); 5xx and network errors are retried
  // with a growing delay, then surfaced as an error.
  useEffect(() => {
    if (!tracked || !view || TERMINAL_STATES.has(view.state)) return;
    const delay = POLL_MS * (pollFailures.current + 1);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(endpoint(tracked));
        if (res.status === 404) {
          pollFailures.current = 0;
          setJob(lostJob(tracked));
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pollFailures.current = 0;
        const record = await res.json();
        setJob({ ...tracked, record } as Tracked);
      } catch {
        pollFailures.current += 1;
        if (pollFailures.current >= MAX_POLL_FAILURES) {
          pollFailures.current = 0;
          setJob({ status: 'error', message: t('errorGeneric') });
        } else {
          setPollRetry((n) => n + 1);
        }
      }
    }, delay);
    return () => clearTimeout(timer);
    // t only changes with the language and is read when the error is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked?.record, pollRetry]);

  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const uploadToken = useRef(0);

  const onFile = useCallback(
    async (file: File) => {
      // Swapping the photo mid-render would orphan a running job.
      if (busyRef.current) return;
      // Only the most recent upload may update the state: a slow earlier
      // upload must not replace a newer photo.
      const token = ++uploadToken.current;
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      const localUrl = URL.createObjectURL(file);
      localUrlRef.current = localUrl;
      setJob({ status: 'idle' });
      setUpload({ status: 'uploading', localUrl });
      const form = new FormData();
      form.set('image', file);
      const settle = (next: UploadState) => {
        if (token === uploadToken.current) setUpload(next);
      };
      try {
        const res = await apiFetch('/api/uploads', { method: 'POST', body: form });
        if (res.status === 413) return settle({ status: 'error', message: t('errorUpload413') });
        if (res.status === 415) return settle({ status: 'error', message: t('errorUpload415') });
        if (!res.ok) return settle({ status: 'error', message: t('errorGeneric') });
        const result = (await res.json()) as UploadResult;
        settle({ status: 'ready', localUrl, imageRef: result.imageRef });
      } catch {
        settle({ status: 'error', message: t('errorGeneric') });
      }
    },
    [t],
  );

  const loadSample = async () => {
    const res = await fetch('/media/demo-assets/images/sample-16x9.png');
    if (!res.ok) return setUpload({ status: 'error', message: t('errorGeneric') });
    await onFile(new File([await res.blob()], 'sample.png', { type: 'image/png' }));
  };

  /** Showcase: a sample photo stands in for an upload; nothing is sent anywhere. */
  const pickSample = (sample: SampleSummary) => {
    if (busyRef.current) return;
    setJob({ status: 'idle' });
    setUpload({ status: 'ready', localUrl: sample.url, imageRef: sample.imageRef });
  };

  const onPreset = (id: string) => {
    if (mode === 'single') setPresetId(id);
    else setShots((current) => (current.length < MAX_SHOTS ? [...current, { presetId: id, prompt: '' }] : current));
  };

  const ready = upload.status === 'ready' && modelId !== null && !busy;
  const canGenerate = remix
    ? ready && remix.text.trim().length > 0
    : mode === 'single'
      ? ready && presetId !== null
      : ready && shots.length >= 2;

  /** Show the server's answer on `text` for `model`, unless the text changed while it was on its way. */
  const setRemixCheck = (text: string, model: string | null, check: RemixCheck) =>
    setRemix((current) => (current && current.text === text ? { ...current, check, checkModel: model } : current));

  /** Open the editor on a preset: the library file, or the text a past remix (`generationId`) was rendered from. */
  const openRemix = async (id: string, source = `/api/presets/${encodeURIComponent(id)}/yaml`, generationId?: string) => {
    const baseName = presets.find((preset) => preset.id === id)?.name ?? id;
    let next: Remix;
    try {
      const res = await apiFetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      next = { baseId: id, baseName, original: text, text, generationId };
    } catch {
      next = { baseId: id, baseName, original: '', text: '', generationId, check: { kind: 'error' } };
    }
    remixFocus.current = 'editor';
    setRemix(next);
  };

  /** The result's "Remix preset": back to the editor if it holds this generation's preset, else open it there. */
  const remixResult = async (record: GenerationRecord) => {
    const action = resultRemixAction(remix, record);
    if (action === 'focus') return remixTextRef.current?.focus();
    if (action === 'confirm' && !window.confirm(t('remixReplace', { name: remix?.baseName ?? '' }))) return;
    await openRemix(record.presetId, presetTextUrl(record), record.remix ? record.id : undefined);
  };

  const closeRemix = () => {
    remixFocus.current = 'toggle';
    setRemix(null);
  };

  const checkRemix = async () => {
    if (!remix) return;
    const { text } = remix;
    // The dry compile runs on this model: its answer is shown only while this model stays chosen.
    const model = modelId;
    setRemixCheck(text, model, { kind: 'checking' });
    try {
      const res = await apiFetch('/api/presets/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml: text, modelId: model }),
      });
      if (res.ok) {
        setRemixCheck(text, model, { kind: 'valid', name: ((await res.json()) as { preset: { name: string } }).preset.name });
      } else if (res.status === 422) {
        setRemixCheck(text, model, { kind: 'problems', problems: ((await res.json()) as { problems: string[] }).problems });
      } else {
        setRemixCheck(text, model, { kind: res.status === 413 ? 'too-large' : 'error' });
      }
    } catch {
      setRemixCheck(text, model, { kind: 'error' });
    }
  };

  /**
   * `onRefused` may take over a refused request (a remix the server finds invalid):
   * it returns true when it showed the reason itself.
   */
  const submit = async (
    kind: Tracked['kind'],
    body: unknown,
    onRefused?: (status: number, refusal: Refusal | null) => boolean,
  ): Promise<Tracked['record'] | undefined> => {
    submitting.current = true;
    setJob({ status: 'submitting' });
    try {
      const res = await apiFetch(kind === 'sequence' ? '/api/sequences' : '/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const refusal = (await res.json().catch(() => null)) as Refusal | null;
        if (onRefused?.(res.status, refusal)) setJob({ status: 'idle' });
        else setJob({ status: 'error', message: t(refusalMessageKey(refusal?.error)) });
        return;
      }
      const record = (await res.json()) as Tracked['record'];
      setJob({ status: 'tracking', kind, record } as Tracked);
      return record;
    } catch {
      setJob({ status: 'error', message: t('errorGeneric') });
    } finally {
      submitting.current = false;
    }
  };

  const generate = () => {
    if (submitting.current || !canGenerate || upload.status !== 'ready') return;
    const userPrompt = prompt.trim() || undefined;
    if (remix) {
      const { text, baseId } = remix;
      const model = modelId;
      void submit('generation', { presetYaml: text, modelId: model, imageRef: upload.imageRef, userPrompt }, (status, refusal) => {
        if (status === 413) {
          setRemixCheck(text, model, { kind: 'too-large' });
        } else if (status === 400 && refusal?.error === 'invalid-preset') {
          setRemixCheck(text, model, { kind: 'problems', problems: refusal.problems ?? [] });
        } else {
          return false;
        }
        remixTextRef.current?.focus();
        return true;
      }).then((record) => {
        // This editor now holds that generation's remix: the result's "Remix preset" leads back here.
        if (record) setRemix((current) => (current?.baseId === baseId ? { ...current, generationId: record.id } : current));
      });
    } else if (mode === 'single') {
      void submit('generation', { presetId, modelId, imageRef: upload.imageRef, userPrompt });
    } else {
      void submit('sequence', {
        imageRef: upload.imageRef,
        shots: shots.map((shot) => ({
          presetId: shot.presetId,
          modelId,
          userPrompt: [userPrompt, shot.prompt.trim()].filter(Boolean).join(', ') || undefined,
        })),
      });
    }
  };

  const cancel = async () => {
    if (!tracked) return;
    try {
      const res = await apiFetch(`${endpoint(tracked)}/cancel`, { method: 'POST' });
      if (res.status === 404) setJob(lostJob(tracked));
      else if (res.ok) setJob({ ...tracked, record: await res.json() } as Tracked);
    } catch {
      // the next poll reports the real state
    }
  };

  const monitorState: GenerationState =
    job.status === 'tracking' ? { status: 'tracking', record: trackedJob(job) } : job;
  const statusLabel =
    tracked?.kind === 'sequence' && tracked.record.state === 'assembling'
      ? tracked.record.stage === 'loading-ffmpeg'
        ? t('showcaseLoadingFfmpeg')
        : t('assembling')
      : tracked?.kind === 'sequence'
        ? t('shotProgress', {
            i: tracked.record.currentShot + 1,
            n: tracked.record.shots.length,
            p: Math.round(tracked.record.progress * 100),
          })
        : undefined;

  const selectedModel = models.find((model) => model.id === modelId);
  const estimate = selectedModel?.estimate_s['480p'] ?? 0;
  const filmEstimate = estimate * Math.max(shots.length, 2) + ASSEMBLY_ESTIMATE_S;
  const primaryLabel = primaryLabelKey(mode, remix !== null, { showcase: IS_SHOWCASE, remixRender: capabilities.remixRender });
  const selectedSample = upload.status === 'ready' && upload.imageRef.startsWith('samples/') ? upload.imageRef.slice('samples/'.length) : null;
  const succeeded = tracked && tracked.record.state === 'succeeded' ? tracked.record : undefined;
  const repoUrl = showcase?.repoUrl ?? null;

  return (
    <>
      <Header recording={busy} />
      <main className={styles.studio}>
        <section className={styles.stage} aria-label="Monitor">
          <Monitor
            upload={upload}
            generation={monitorState}
            onFile={onFile}
            onSample={loadSample}
            onCancel={cancel}
            onRetry={() => setJob({ status: 'idle' })}
            statusLabel={statusLabel}
            showcase={
              IS_SHOWCASE
                ? {
                    samples: showcase?.samples ?? [],
                    selectedId: selectedSample,
                    note: showcase
                      ? showcaseNoteKeys(showcase.placeholders)
                          .map((key) => t(key, { model: showcase.model.name, license: showcase.model.license }))
                          .join(' ')
                      : '',
                    onPick: pickSample,
                    uploads: capabilities.uploads,
                    onOtherSample: () => {
                      if (busyRef.current) return;
                      setJob({ status: 'idle' });
                      setUpload({ status: 'idle' });
                    },
                    onRefusedFile: () => setJob({ status: 'error', message: t('errorShowcaseUpload') }),
                  }
                : undefined
            }
          />
          {IS_SHOWCASE && succeeded && (
            <p className={styles.caption} data-testid="result-caption">
              {succeeded.placeholder
                ? t('showcasePlaceholderCaption')
                : t('showcaseCaption', { model: showcase?.model.name ?? '', license: showcase?.model.license ?? '' })}
            </p>
          )}
          {tracked?.kind === 'generation' && tracked.record.state === 'succeeded' && (
            <div className={styles.actions}>
              {tracked.record.outputUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.outputUrl} download={`montagio-${tracked.record.presetId}.mp4`}>
                  {t('download')}
                </a>
              )}
              <a
                className={styles.buttonSecondary}
                href={tracked.record.workflowUrl ?? `/api/workflows/${tracked.record.id}`}
                download={`montagio-${tracked.record.presetId}.json`}
              >
                {t('openInComfy')}
              </a>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => void remixResult(tracked.record)}
              >
                {t('remix')}
              </button>
            </div>
          )}
          {tracked?.kind === 'sequence' && tracked.record.state === 'succeeded' && (
            <div className={styles.actions}>
              {tracked.record.outputUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.outputUrl} download="montagio-film.mp4">
                  {t('downloadFilm')}
                </a>
              )}
              {tracked.record.verticalUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.verticalUrl} download="montagio-film-9x16.mp4">
                  {t('downloadVertical')}
                </a>
              )}
            </div>
          )}
        </section>

        <aside className={styles.panel}>
          <div className={styles.modes} role="group" aria-label={t('modeLabel')}>
            {(['single', 'sequence'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={styles.mode}
                aria-pressed={mode === value}
                disabled={busy || remix !== null}
                onClick={() => {
                  setMode(value);
                  // The film is joined by FFmpeg in the browser: start fetching it now.
                  if (IS_SHOWCASE && value === 'sequence') void apiFetch('/api/showcase/preload', { method: 'POST' }).catch(() => undefined);
                }}
              >
                {value === 'single' ? t('modeSingle') : t('modeSequence')}
              </button>
            ))}
          </div>
          {remix ? (
            <RemixEditor
              baseId={remix.baseId}
              baseName={remix.baseName}
              text={remix.text}
              original={remix.original}
              check={remix.checkModel === undefined || remix.checkModel === modelId ? remix.check : undefined}
              textareaRef={remixTextRef}
              onChange={(text) => setRemix((current) => current && { ...current, text, check: undefined })}
              onCheck={checkRemix}
              onReset={() => setRemix((current) => current && { ...current, text: current.original, check: undefined })}
              onClose={closeRemix}
            />
          ) : (
            <PresetGallery
              presets={presets}
              selectedId={mode === 'single' ? presetId : null}
              onSelect={onPreset}
            />
          )}
          {mode === 'single' && !remix && (
            <button
              ref={remixToggleRef}
              type="button"
              className={styles.buttonSecondary}
              aria-expanded={false}
              disabled={presetId === null}
              onClick={() => presetId && openRemix(presetId)}
            >
              {t('remix')}
            </button>
          )}
          {mode === 'sequence' && (
            <ShotList
              shots={shots}
              presets={presets}
              max={MAX_SHOTS}
              onRemove={(index) => setShots((current) => current.filter((_, i) => i !== index))}
              onPromptChange={(index, text) =>
                setShots((current) => current.map((shot, i) => (i === index ? { ...shot, prompt: text } : shot)))
              }
              promptsDisabled={IS_SHOWCASE}
            />
          )}
          {mode === 'sequence' && IS_SHOWCASE && <p className={styles.hint}>{t('showcaseSequenceNote')}</p>}
          <ModelPicker
            models={models}
            selectedId={modelId}
            onSelect={setModelId}
            onlyId={IS_SHOWCASE ? (showcase?.model.id ?? modelId ?? '') : undefined}
          />
          <div className={styles.panelSection}>
            <label htmlFor="scene-prompt" className={styles.sectionTitle}>
              {t('prompt')}
            </label>
            <textarea
              id="scene-prompt"
              className={styles.prompt}
              rows={2}
              maxLength={500}
              placeholder={t('promptPlaceholder')}
              value={prompt}
              disabled={IS_SHOWCASE}
              aria-describedby={IS_SHOWCASE ? 'scene-local' : undefined}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {IS_SHOWCASE && (
              <p id="scene-local" className={styles.hint}>
                {t('showcasePromptLocal')}
              </p>
            )}
          </div>
          <div className={styles.generateBlock}>
            {primaryLabel ? (
              <button type="button" className={styles.buttonPrimary} disabled={!canGenerate} onClick={generate}>
                {t(primaryLabel, { s: mode === 'sequence' && !remix ? filmEstimate : estimate })}
              </button>
            ) : (
              <div className={styles.showcaseNote} role="note">
                <p>{t('showcaseRemixNote')}</p>
                {repoUrl && (
                  <a className={styles.buttonSecondary} href={repoUrl} rel="noreferrer">
                    {t('showcaseRunLocally')}
                  </a>
                )}
              </div>
            )}
            {upload.status !== 'ready' && primaryLabel && <p className={styles.hint}>{t('generateHint')}</p>}
            {!IS_SHOWCASE && <p className={styles.note}>{t('localNote')}</p>}
          </div>
        </aside>
      </main>
      <ShowcaseFooter />
    </>
  );
}
