'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  TERMINAL_STATES,
  type GenerationRecord,
  type JobState,
  type ModelSummary,
  type PresetSummary,
  type SequenceSummary,
  type UploadResult,
} from '@/lib/api-types';
import { Header } from './Header';
import { ModelPicker } from './ModelPicker';
import { Monitor, type GenerationState, type TrackedJob, type UploadState } from './Monitor';
import { PresetGallery } from './PresetGallery';
import { RemixEditor, type RemixCheck } from './RemixEditor';
import { ShotList } from './ShotList';
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

/** A preset being remixed: the library text it started from and the edited text. */
type Remix = { baseId: string; baseName: string; original: string; text: string; check?: RemixCheck };

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

  useEffect(() => {
    Promise.all([
      fetch('/api/presets').then((res) => res.json() as Promise<PresetSummary[]>),
      fetch('/api/models').then((res) => res.json() as Promise<ModelSummary[]>),
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
  useEffect(() => {
    if (remixFocus.current === 'editor') remixTextRef.current?.focus();
    if (remixFocus.current === 'toggle') remixToggleRef.current?.focus();
    remixFocus.current = null;
  }, [remix?.baseId]);

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
        const res = await fetch(endpoint(tracked));
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
        const res = await fetch('/api/uploads', { method: 'POST', body: form });
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

  /** Show a check result, unless the text changed while it was on its way. */
  const setRemixCheck = (text: string, check: RemixCheck | undefined) =>
    setRemix((current) => (current && current.text === text ? { ...current, check } : current));

  const openRemix = async (id: string) => {
    if (remix?.baseId === id) {
      remixTextRef.current?.focus();
      return;
    }
    const baseName = presets.find((preset) => preset.id === id)?.name ?? id;
    remixFocus.current = 'editor';
    try {
      const res = await fetch(`/api/presets/${encodeURIComponent(id)}/yaml`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setRemix({ baseId: id, baseName, original: text, text });
    } catch {
      setRemix({ baseId: id, baseName, original: '', text: '', check: { kind: 'error' } });
    }
  };

  const closeRemix = () => {
    remixFocus.current = 'toggle';
    setRemix(null);
  };

  const checkRemix = async () => {
    if (!remix) return;
    const { text } = remix;
    setRemixCheck(text, { kind: 'checking' });
    try {
      const res = await fetch('/api/presets/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml: text, modelId }),
      });
      if (res.ok) {
        setRemixCheck(text, { kind: 'valid', name: ((await res.json()) as { preset: { name: string } }).preset.name });
      } else if (res.status === 422) {
        setRemixCheck(text, { kind: 'problems', problems: ((await res.json()) as { problems: string[] }).problems });
      } else {
        setRemixCheck(text, { kind: res.status === 413 ? 'too-large' : 'error' });
      }
    } catch {
      setRemixCheck(text, { kind: 'error' });
    }
  };

  /**
   * `onRefused` may take over a refused request (a remix the server finds invalid):
   * it returns true when it showed the reason itself.
   */
  const submit = async (kind: Tracked['kind'], body: unknown, onRefused?: (res: Response) => Promise<boolean>) => {
    submitting.current = true;
    setJob({ status: 'submitting' });
    try {
      const res = await fetch(kind === 'sequence' ? '/api/sequences' : '/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const shown = onRefused ? await onRefused(res).catch(() => false) : false;
        setJob(shown ? { status: 'idle' } : { status: 'error', message: t('errorGeneric') });
        return;
      }
      setJob({ status: 'tracking', kind, record: await res.json() } as Tracked);
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
      const { text } = remix;
      void submit('generation', { presetYaml: text, modelId, imageRef: upload.imageRef, userPrompt }, async (res) => {
        if (res.status === 413) {
          setRemixCheck(text, { kind: 'too-large' });
          return true;
        }
        const refusal = res.status === 400 ? ((await res.json()) as { error?: string; problems?: string[] }) : null;
        if (refusal?.error !== 'invalid-preset') return false;
        setRemixCheck(text, { kind: 'problems', problems: refusal.problems ?? [] });
        remixTextRef.current?.focus();
        return true;
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
      const res = await fetch(`${endpoint(tracked)}/cancel`, { method: 'POST' });
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
      ? t('assembling')
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
          />
          {tracked?.kind === 'generation' && tracked.record.state === 'succeeded' && (
            <div className={styles.actions}>
              {tracked.record.outputUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.outputUrl} download>
                  {t('download')}
                </a>
              )}
              <a className={styles.buttonSecondary} href={`/api/workflows/${tracked.record.id}`} download>
                {t('openInComfy')}
              </a>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => (tracked.record.remix && remix ? remixTextRef.current?.focus() : openRemix(tracked.record.presetId))}
              >
                {t('remix')}
              </button>
            </div>
          )}
          {tracked?.kind === 'sequence' && tracked.record.state === 'succeeded' && (
            <div className={styles.actions}>
              {tracked.record.outputUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.outputUrl} download>
                  {t('downloadFilm')}
                </a>
              )}
              {tracked.record.verticalUrl && (
                <a className={styles.buttonSecondary} href={tracked.record.verticalUrl} download>
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
                onClick={() => setMode(value)}
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
              check={remix.check}
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
            />
          )}
          <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
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
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
          <div className={styles.generateBlock}>
            <button type="button" className={styles.buttonPrimary} disabled={!canGenerate} onClick={generate}>
              {remix
                ? t('generateRemix', { s: estimate })
                : mode === 'single'
                  ? t('generate', { s: estimate })
                  : t('generateFilm', { s: filmEstimate })}
            </button>
            {upload.status !== 'ready' && <p className={styles.hint}>{t('generateHint')}</p>}
            <p className={styles.note}>{t('localNote')}</p>
          </div>
        </aside>
      </main>
    </>
  );
}
