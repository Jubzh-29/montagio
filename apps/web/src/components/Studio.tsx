'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import {
  TERMINAL_STATES,
  type GenerationRecord,
  type HistoryItem,
  type JobState,
  type JobSummary,
  type ModelSummary,
  type PresetSummary,
  type SampleSummary,
  type SequenceSummary,
  type ShowcaseInfo,
  type UploadResult,
} from '@/lib/api-types';
import { refusalMessageKey } from '@/lib/refusals';
import { applyReprise } from '@/lib/reprise';
import { presetTextUrl, resultRemixAction } from '@/lib/remix';
import { primaryLabelKey, showcaseNoteKeys, studioCapabilities } from '@/lib/showcase-ui';
import { useMotionPaused } from '@/lib/use-motion';
import { needsConsent } from '@/lib/consent';
import { defaultSubject } from '@/lib/effect-choice';
import { nextView, type CanvasEvent, type CanvasState } from '@/lib/studio-view';
import { HOOKS_READY, pickTab, tabHref, visibleTabs } from '@/lib/tabs';
import { refreshExtensions, useExtensions } from '@/lib/use-extensions';
import { useShowcase } from '@/lib/use-showcase';
import { AiCaption } from './AiCaption';
import { Canvas } from './Canvas';
import { ChoiceCard } from './ChoiceCard';
import { Composer } from './Composer';
import { ConsentCheck } from './ConsentCheck';
import { EffectFields } from './EffectFields';
import { EffectWall } from './EffectWall';
import { Header } from './Header';
import { ModelPicker } from './ModelPicker';
import { Monitor, type GenerationState, type TrackedJob, type UploadState } from './Monitor';
import { PhotoAtelier, type AtelierPhoto } from './PhotoAtelier';
import { PhotoSource } from './PhotoSource';
import { PresetGallery, type SequenceTiles } from './PresetGallery';
import { RecentStrip } from './RecentStrip';
import { RemixEditor, type RemixCheck } from './RemixEditor';
import { ShotList } from './ShotList';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './studio.module.css';

const POLL_MS = 1000;
const MAX_POLL_FAILURES = 4;
const MAX_SHOTS = 3;
const ASSEMBLY_ESTIMATE_S = 5;
/** Every library preset renders 5 s at 480p (presets/*.yaml, defaults). */
const CLIP_SECONDS = 5;

type Mode = 'single' | 'sequence';

/** A shot being composed: its camera move and its own optional text. */
type ShotDraft = { presetId: string; prompt: string };

/** A render in progress or finished: a single generation, a sequence of shots, or an effect (a job). */
type Job =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'tracking'; kind: 'generation'; record: GenerationRecord }
  | { status: 'tracking'; kind: 'sequence'; record: SequenceSummary }
  | { status: 'tracking'; kind: 'job'; record: JobSummary }
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
  if (job.kind === 'generation' || job.kind === 'job') return job.record;
  const { id, progress, outputUrl, error } = job.record;
  return { id, progress, outputUrl, error, state: SEQUENCE_STATE[job.record.state] };
}

const ENDPOINTS: Record<Tracked['kind'], string> = { generation: 'generations', sequence: 'sequences', job: 'jobs' };
const endpoint = (job: Tracked) => `/api/${ENDPOINTS[job.kind]}/${job.record.id}`;

/** The same job, marked as lost by the server (404). */
function lostJob(job: Tracked): Job {
  return { ...job, record: { ...job.record, state: 'failed', error: 'lost' } } as Tracked;
}

export function Studio() {
  const { t } = useI18n();
  // The tab comes from the URL (?tab=), among those the extensions allow; Camera is the single shot, Film the sequence.
  const extensions = useExtensions();
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const tab = pickTab(requestedTab, visibleTabs(extensions));
  const mode: Mode = tab === 'film' ? 'sequence' : 'single';
  const [canvas, setCanvas] = useState<CanvasState>({ view: 'gallery', before: 'gallery' });
  // The photo atelier (text to image, edit), over the canvas; and the text of a photo made from one.
  const [atelier, setAtelier] = useState<'t2i' | 'edit' | null>(null);
  const [photoPrompt, setPhotoPrompt] = useState<string | undefined>(undefined);
  // The Effects tab: the effect chosen on the wall, what the photo shows, and the consent box.
  const [effectId, setEffectId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [consent, setConsent] = useState(false);
  // History: the latest creations under the result, and the item a "Reuse" link brings back (?from=).
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const [from, setFrom] = useState<string | null>(null);
  const appliedFrom = useRef<string | null>(null);
  const [repriseNotice, setRepriseNotice] = useState(false);
  const moveCanvas = (event: CanvasEvent) => setCanvas((current) => nextView(event, current));
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [models, setModels] = useState<ModelSummary[]>([]);
  // Every model of the catalogue (text to image included), for the licenses shown under a result.
  const [catalogModels, setCatalogModels] = useState<ModelSummary[]>([]);
  const [catalog, setCatalog] = useState<'loading' | 'ready' | 'failed'>('loading');
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
  const [motionPaused, setMotionPaused] = useMotionPaused();

  // The showcase opens on a clip already playing: the first sample photo with the first preset, as if
  // "Show clip" had been pressed, unless the visitor picked something while the catalogue loaded.
  const touched = useRef(false);
  const [arrivalId, setArrivalId] = useState<string | null>(null);
  const followJob = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  // The editor takes the gallery's place: move the focus with it, and back on close.
  // remixFocus is set just before the setRemix that opens, refills or closes the editor.
  useEffect(() => {
    if (remixFocus.current === 'editor') remixTextRef.current?.focus();
    if (remixFocus.current === 'toggle') remixToggleRef.current?.focus();
    remixFocus.current = null;
  }, [remix, canvas.view]);

  // A new tab opens on its wall, and the remix editor belongs to the Camera tab (state adjusted while rendering).
  const [shownTab, setShownTab] = useState(tab);
  if (shownTab !== tab) {
    setShownTab(tab);
    setCanvas((current) => nextView('tab', current));
    if (tab !== 'camera' && remix) setRemix(null);
  }
  useEffect(() => {
    // The film is joined by FFmpeg in the browser: start fetching it now.
    if (IS_SHOWCASE && tab === 'film') void apiFetch('/api/showcase/preload', { method: 'POST' }).catch(() => undefined);
  }, [tab]);

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

  // The latest creations, under the result: at the start, and after each render that succeeds.
  const loadRecent = useCallback(() => {
    apiFetch('/api/history')
      .then((res) => jsonOrThrow<HistoryItem[]>(res))
      .then(setRecent)
      .catch(() => undefined);
  }, []);
  const finishedId = view?.state === 'succeeded' ? view.id : null;
  useEffect(() => {
    loadRecent();
  }, [loadRecent, finishedId]);

  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const uploadToken = useRef(0);

  const onFile = useCallback(
    async (file: File) => {
      // Swapping the photo mid-render would orphan a running job.
      if (busyRef.current) return;
      touched.current = true;
      // Only the most recent upload may update the state: a slow earlier
      // upload must not replace a newer photo.
      const token = ++uploadToken.current;
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      const localUrl = URL.createObjectURL(file);
      localUrlRef.current = localUrl;
      setJob({ status: 'idle' });
      setPhotoPrompt(undefined);
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
        settle({ status: 'ready', localUrl, imageRef: result.imageRef, personal: result.personal });
      } catch {
        settle({ status: 'error', message: t('errorGeneric') });
      }
    },
    [t],
  );

  /** The sample photo, copied by the server: its origin is known, so no effect on it asks for consent. */
  const loadSample = async () => {
    if (busyRef.current) return;
    touched.current = true;
    const token = ++uploadToken.current;
    const localUrl = '/media/demo-assets/images/sample-16x9.png';
    setJob({ status: 'idle' });
    setPhotoPrompt(undefined);
    setUpload({ status: 'uploading', localUrl });
    const settle = (next: UploadState) => {
      if (token === uploadToken.current) setUpload(next);
    };
    try {
      const res = await apiFetch('/api/uploads/sample', { method: 'POST' });
      if (!res.ok) return settle({ status: 'error', message: t('errorGeneric') });
      const result = (await res.json()) as UploadResult;
      settle({ status: 'ready', localUrl, imageRef: result.imageRef, personal: result.personal });
    } catch {
      settle({ status: 'error', message: t('errorGeneric') });
    }
  };

  /** Showcase: a sample photo stands in for an upload; nothing is sent anywhere. */
  const openAtelier = (kind: 't2i' | 'edit') => {
    if (busyRef.current) return;
    setAtelier(kind);
    setCanvas((current) => nextView('open-atelier', current));
  };

  const closeAtelier = () => {
    setAtelier(null);
    setCanvas((current) => nextView('close-atelier', current));
  };

  /** The atelier's image becomes the start photo, as any upload would. */
  const usePhoto = (photo: AtelierPhoto) => {
    touched.current = true;
    ++uploadToken.current;
    setJob({ status: 'idle' });
    setUpload({ status: 'ready', localUrl: photo.url, imageRef: photo.imageRef, personal: photo.personal });
    setPhotoPrompt(photo.prompt);
    closeAtelier();
  };

  const pickSample = (sample: SampleSummary) => {
    touched.current = true;
    if (busyRef.current) return;
    setJob({ status: 'idle' });
    setPhotoPrompt(undefined);
    setUpload({ status: 'ready', localUrl: sample.url, imageRef: sample.imageRef, personal: false });
  };

  const onPreset = (id: string) => {
    if (mode === 'single') setPresetId(id);
    else setShots((current) => (current.length < MAX_SHOTS ? [...current, { presetId: id, prompt: '' }] : current));
  };

  const effects = extensions?.effects ?? [];
  const selectedEffect = effects.find((effect) => effect.id === effectId) ?? effects[0];
  const askConsent = tab === 'effects' && needsConsent(upload, 'effect');
  // A photo made from a text says what it shows (state adjusted while rendering, when that photo changes).
  const [subjectFor, setSubjectFor] = useState(photoPrompt);
  if (subjectFor !== photoPrompt) {
    setSubjectFor(photoPrompt);
    setSubject(defaultSubject(photoPrompt, selectedEffect?.subjectMax ?? 120));
  }
  // Another photo asks for consent again.
  const photoKey = upload.status === 'ready' ? upload.imageRef : null;
  const [consentFor, setConsentFor] = useState(photoKey);
  if (consentFor !== photoKey) {
    setConsentFor(photoKey);
    setConsent(false);
  }

  const ready = upload.status === 'ready' && modelId !== null && !busy;
  const canGenerate = tab === 'effects'
    ? upload.status === 'ready' && !busy && selectedEffect !== undefined && (!askConsent || consent)
    : remix
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
    // The editor takes the wall's place in the canvas.
    setCanvas((current) => nextView('change', current));
  };

  /** The result's "Remix preset": back to the editor if it holds this generation's preset, else open it there. */
  const remixResult = async (record: GenerationRecord) => {
    const action = resultRemixAction(remix, record);
    if (action === 'focus') {
      // The editor is on the canvas's wall side: show it, then the focus effect moves there.
      remixFocus.current = 'editor';
      return setCanvas((current) => nextView('change', current));
    }
    if (action === 'confirm' && !window.confirm(t('remixReplace', { name: remix?.baseName ?? '' }))) return;
    await openRemix(record.presetId, presetTextUrl(record), record.remix ? record.id : undefined);
  };

  const closeRemix = () => {
    remixFocus.current = 'toggle';
    setRemix(null);
  };

  /** A history item's "Reuse": its tab, photo, choice and texts come back, ready to render again. */
  const restore = (item: HistoryItem) => {
    const back = applyReprise(item);
    touched.current = true;
    ++uploadToken.current;
    setJob({ status: 'idle' });
    if (back.photo) {
      const sample = showcase?.samples.find((entry) => entry.imageRef === back.photo!.imageRef);
      setUpload({ status: 'ready', localUrl: sample?.url ?? `/media/data/${back.photo.imageRef}`, imageRef: back.photo.imageRef, personal: back.photo.personal });
    } else {
      setUpload({ status: 'idle' });
    }
    setRepriseNotice(back.notice === 'photo-missing');
    setPhotoPrompt(back.photoPrompt);
    setSubjectFor(back.photoPrompt);
    setSubject(back.subject ?? defaultSubject(back.photoPrompt, 120));
    if (back.presetId) setPresetId(back.presetId);
    if (back.modelId && models.some((model) => model.id === back.modelId)) setModelId(back.modelId);
    if (back.prompt !== undefined) setPrompt(back.prompt);
    if (back.shots) setShots(back.shots);
    if (back.effectId) setEffectId(back.effectId);
    setCanvas({ view: 'gallery', before: 'gallery' });
    if (back.remixGenerationId && back.presetId) {
      void openRemix(back.presetId, `/api/generations/${encodeURIComponent(back.remixGenerationId)}/preset`, back.remixGenerationId);
    }
    // The link did its work: the address keeps the tab only.
    window.history.replaceState(null, '', tabHref(back.tab));
  };

  useEffect(() => {
    if (!from || catalog !== 'ready' || appliedFrom.current === from) return;
    appliedFrom.current = from;
    apiFetch('/api/history')
      .then((res) => jsonOrThrow<HistoryItem[]>(res))
      .then((items) => {
        const item = items.find((entry) => entry.key === from);
        if (item) restore(item);
      })
      .catch(() => undefined);
    // restore reads the catalogue, which is ready here; the item to bring back is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, catalog]);

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
    path?: string,
  ): Promise<Tracked['record'] | undefined> => {
    submitting.current = true;
    setJob({ status: 'submitting' });
    try {
      const res = await apiFetch(path ?? (kind === 'sequence' ? '/api/sequences' : '/api/generations'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const refusal = (await res.json().catch(() => null)) as Refusal | null;
        // ComfyUI refused a workflow: the server now hides that extension, and so does the Studio.
        if (refusal?.error === 'workflow-rejected') refreshExtensions();
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

  // The catalogue, fetched once; in the showcase it also starts the arrival clip.
  useEffect(() => {
    Promise.all([
      apiFetch('/api/presets').then((res) => jsonOrThrow<PresetSummary[]>(res)),
      apiFetch('/api/models').then((res) => jsonOrThrow<ModelSummary[]>(res)),
      IS_SHOWCASE
        ? apiFetch('/api/showcase')
            .then((res) => (res.ok ? (res.json() as Promise<ShowcaseInfo>) : null))
            .catch(() => null)
        : null,
    ])
      .then(([presetList, modelList, info]) => {
        setPresets(presetList);
        setModels(modelList.filter((model) => model.kind === 'video'));
        setCatalogModels(modelList);
        setCatalog('ready');
        setPresetId((current) => current ?? presetList[0]?.id ?? null);
        setModelId((current) => current ?? presetList[0]?.defaultModel ?? null);
        const sample = info?.samples[0];
        const first = presetList[0];
        if (sample && first && !touched.current) {
          setUpload({ status: 'ready', localUrl: sample.url, imageRef: sample.imageRef, personal: false });
          setCanvas({ view: 'result', before: 'gallery' });
          void submit('generation', { presetId: first.id, modelId: first.defaultModel, imageRef: sample.imageRef }).then(
            (record) => record && setArrivalId(record.id),
          );
        }
      })
      .catch(() => {
        setCatalog('failed');
        setJob({ status: 'error', message: t('errorGeneric') });
      });
    // t only changes with the language; the catalog is fetched once (submit is called after the first render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = () => {
    if (submitting.current || !canGenerate || upload.status !== 'ready') return;
    followJob.current = true;
    moveCanvas('generate');
    const userPrompt = prompt.trim() || undefined;
    if (tab === 'effects') {
      if (!selectedEffect) return;
      const body = { imageRef: upload.imageRef, effectId: selectedEffect.id, subject: subject.trim(), ...(askConsent ? { consent } : {}) };
      void submit('job', body, undefined, '/api/effects');
      return;
    }
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

  // A render the visitor started (followJob, set by generate): the focus follows it, to the render
  // status (on a phone that scrolls the monitor back into view), then to the result's first action.
  const viewState = view?.state;
  useEffect(() => {
    if (!followJob.current) return;
    if (job.status === 'submitting') {
      statusRef.current?.focus();
    } else if (job.status !== 'tracking' || (viewState && TERMINAL_STATES.has(viewState))) {
      followJob.current = false;
      if (viewState === 'succeeded') actionsRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    }
  }, [job.status, viewState]);

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
  const estimate = tab === 'effects' ? (selectedEffect?.estimate_s ?? 0) : (selectedModel?.estimate_s['480p'] ?? 0);
  const filmEstimate = estimate * Math.max(shots.length, 2) + ASSEMBLY_ESTIMATE_S;
  const primaryLabel = primaryLabelKey(mode, remix !== null, { showcase: IS_SHOWCASE, remixRender: capabilities.remixRender });
  const selectedSample = upload.status === 'ready' && upload.imageRef.startsWith('samples/') ? upload.imageRef.slice('samples/'.length) : null;
  const succeeded = tracked && tracked.record.state === 'succeeded' ? tracked.record : undefined;
  const sequenceTiles: SequenceTiles = {
    shotsOf: (id) => shots.flatMap((shot, index) => (shot.presetId === id ? [index + 1] : [])),
    nextShot: shots.length < MAX_SHOTS ? shots.length + 1 : null,
  };
  const repoUrl = showcase?.repoUrl ?? null;
  const showcaseNote = showcase
    ? showcaseNoteKeys(showcase.placeholders)
        .map((key) => t(key, { model: showcase.model.name, license: showcase.model.license }))
        .join(' ')
    : '';
  // Screen readers hear a render start and end, not every percentage.
  const announcement = busy
    ? tracked?.kind === 'sequence' && tracked.record.state === 'assembling'
      ? t('assembling')
      : t('announceRendering')
    : view?.state === 'succeeded'
      ? t(tracked?.kind === 'sequence' ? 'announceFilmReady' : 'announceClipReady')
      : '';
  // The empty monitor plays the move in hand: the preset being remixed, the chosen one, or the last shot added.
  const moveId = tab === 'effects' ? undefined : remix ? remix.baseId : mode === 'single' ? presetId : shots.at(-1)?.presetId;
  const movePreset = presets.find((preset) => preset.id === moveId);
  const move = movePreset && {
    id: mode === 'sequence' ? `${shots.length}-${movePreset.id}` : movePreset.id,
    poses: movePreset.poses,
    speed: movePreset.speed,
  };
  // The slate under the monitor: the take about to be shot, even once a photo hides the viewfinder.
  const slateMove = tab === 'effects' ? selectedEffect?.name : remix ? t('remixTitle', { name: remix.baseName }) : mode === 'single' ? movePreset?.name : shots.length > 0 ? t('slateShots', { n: shots.length }) : undefined;
  const slate = slateMove && [
    slateMove,
    tab !== 'effects' && selectedModel && t(selectedModel.tier === 'quality' ? 'tierQuality' : 'tierFast'),
    t('slateSpec', { s: mode === 'sequence' && !remix ? CLIP_SECONDS * shots.length : CLIP_SECONDS }),
  ].filter(Boolean);

  const effectOfResult = tracked?.kind === 'job' ? effects.find((effect) => effect.id === tracked.record.label.itemId) : undefined;
  const resultModel: { name: string; license: string } | undefined = effectOfResult
    ? { name: effectOfResult.modelName, license: effectOfResult.license }
    : tracked?.kind === 'generation'
      ? models.find((model) => model.id === tracked.record.modelId)
      : tracked?.kind === 'sequence'
        ? (models.find((model) => model.id === tracked.record.shots[0]?.modelId) ?? selectedModel)
        : undefined;

  return (
    <>
      <Suspense fallback={null}>
        <TabParam
          onTab={(value) => {
            if (value !== null) touched.current = true;
            setRequestedTab(value);
          }}
          onFrom={setFrom}
        />
      </Suspense>
      <Header recording={busy} current={tab} />
      <main className={styles.studio} data-motion={motionPaused ? 'paused' : 'playing'}>
        <h1 className="visually-hidden">
          {t('appName')} — {t('tagline')}
        </h1>
        <Composer
          label={t('composerLabel')}
          choice={
            tab === 'effects' ? (
              selectedEffect ? (
                <ChoiceCard
                  name={selectedEffect.name}
                  kindLabel={t('effectKind', { s: CLIP_SECONDS })}
                  previewUrl={selectedEffect.previewUrl}
                  icon="effect"
                  paused={motionPaused}
                  onChange={() => moveCanvas('change')}
                />
              ) : null
            ) : mode === 'sequence' && !remix ? (
              <>
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
                {IS_SHOWCASE && <p className={styles.hint}>{t('showcaseSequenceNote')}</p>}
              </>
            ) : movePreset ? (
              <ChoiceCard
                name={remix ? t('remixTitle', { name: remix.baseName }) : movePreset.name}
                kindLabel={t('choiceCamera', { s: CLIP_SECONDS })}
                previewUrl={remix ? undefined : movePreset.previewUrl}
                poses={movePreset.poses}
                speed={movePreset.speed}
                icon="camera"
                paused={motionPaused}
                onChange={() => moveCanvas('change')}
              />
            ) : null
          }
          photo={
            <>
            <PhotoSource
              upload={upload}
              disabled={busy}
              onFile={onFile}
              onSample={() => void loadSample()}
              t2i={!IS_SHOWCASE}
              edit={extensions?.extensions.includes('edit') ?? false}
              onAtelier={openAtelier}
              showcase={
                IS_SHOWCASE
                  ? {
                      samples: showcase?.samples ?? [],
                      selectedId: selectedSample,
                      onPick: pickSample,
                      uploads: capabilities.uploads,
                      onRefusedFile: () => setJob({ status: 'error', message: t('errorShowcaseUpload') }),
                    }
                  : undefined
              }
            />
            {repriseNotice && upload.status === 'idle' && (
              <p className={styles.hint} role="status">
                {t('repriseNoPhoto')}
              </p>
            )}
            </>
          }
          fields={
            tab === 'effects' ? (
              selectedEffect && <EffectFields subject={subject} max={selectedEffect.subjectMax} onSubject={setSubject} />
            ) : (
            <>
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
              <ModelPicker
                models={models}
                loading={catalog === 'loading'}
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
            </>
            )
          }
          consent={askConsent ? <ConsentCheck id="effect-consent" checked={consent} onChange={setConsent} /> : undefined}
          generate={
            <>
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
              </div>
              {/* Outside the sticky block: on a phone that block stays one button high over the gallery. */}
              {!IS_SHOWCASE && <p className={styles.note}>{t('localNote')}</p>}
            </>
          }
        />
        <Canvas
          view={canvas.view}
          recent={<RecentStrip items={recent} />}
          atelier={
            atelier && (
              <PhotoAtelier
                key={atelier}
                kind={atelier}
                photo={upload}
                estimates={extensions?.estimates ?? { t2i: 12 }}
                onUse={usePhoto}
                onClose={closeAtelier}
                licenseOf={(id) => catalogModels.find((model) => model.id === id)?.license}
              />
            )
          }
          onView={(value) => setCanvas({ view: value, before: value })}
          gallery={
            tab === 'effects' ? (
              <EffectWall
                effects={effects}
                hooks={HOOKS_READY ? (extensions?.hooks ?? []) : []}
                selectedId={selectedEffect?.id ?? null}
                paused={motionPaused}
                onSelect={setEffectId}
              />
            ) : remix ? (
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
                catalog={catalog}
                selectedId={mode === 'single' ? presetId : null}
                paused={motionPaused}
                onPause={setMotionPaused}
                sequence={mode === 'sequence' ? sequenceTiles : undefined}
                onSelect={onPreset}
              />
            )
          }
          result={
            <>
              <Monitor
                upload={upload}
                generation={monitorState}
                move={move}
                announcement={announcement}
                statusRef={statusRef}
                autoPlayResult={!(motionPaused && view?.id === arrivalId)}
                onFile={onFile}
                onSample={() => void loadSample()}
                onCancel={cancel}
                onRetry={() => setJob({ status: 'idle' })}
                statusLabel={statusLabel}
                showcase={
                  IS_SHOWCASE
                    ? {
                        samples: showcase?.samples ?? [],
                        selectedId: selectedSample,
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
              {slate && (
                <p className={styles.slate}>
                  {slate.map((part, index) => (
                    <span key={index}>{part}</span>
                  ))}
                </p>
              )}
              {IS_SHOWCASE && succeeded && (
                <p className={styles.caption} data-testid="result-caption">
                  {succeeded.placeholder
                    ? t('showcasePlaceholderCaption')
                    : t('showcaseCaption', { model: showcase?.model.name ?? '', license: showcase?.model.license ?? '' })}
                </p>
              )}
              {!IS_SHOWCASE && succeeded && resultModel && <AiCaption modelName={resultModel.name} license={resultModel.license} />}
              {tracked?.kind === 'generation' && tracked.record.state === 'succeeded' && (
                <div className={styles.actions} ref={actionsRef}>
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
                    <span className={styles.fileTag}>.json</span>
                  </a>
                  <button type="button" className={styles.buttonSecondary} onClick={() => void remixResult(tracked.record)}>
                    {t('remix')}
                  </button>
                </div>
              )}
              {tracked?.kind === 'job' && tracked.record.state === 'succeeded' && (
                <div className={styles.actions} ref={actionsRef}>
                  {tracked.record.outputUrl && (
                    <a className={styles.buttonSecondary} href={tracked.record.outputUrl} download={`montagio-${tracked.record.label.itemId ?? tracked.record.task}.mp4`}>
                      {t('download')}
                    </a>
                  )}
                  <a
                    className={styles.buttonSecondary}
                    href={tracked.record.workflowUrl ?? `/api/workflows/${tracked.record.id}`}
                    download={`montagio-${tracked.record.label.itemId ?? tracked.record.task}.json`}
                  >
                    {t('openInComfy')}
                    <span className={styles.fileTag}>.json</span>
                  </a>
                </div>
              )}
              {tracked?.kind === 'sequence' && tracked.record.state === 'succeeded' && (
                <div className={styles.actions} ref={actionsRef}>
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
              {/* What the showcase is, in sight whatever the monitor shows. */}
              {showcaseNote && <p className={styles.stageNote}>{showcaseNote}</p>}
            </>
          }
        />
      </main>
      <ShowcaseFooter />
    </>
  );
}

/** Reads ?tab= in its own Suspense boundary: the rest of the Studio prerenders without the URL. */
function TabParam({ onTab, onFrom }: { onTab: (tab: string | null) => void; onFrom: (key: string | null) => void }) {
  const params = useSearchParams();
  const tab = params.get('tab');
  const from = params.get('from');
  useEffect(() => {
    onTab(tab);
    // onTab is a new function on every render of the Studio; the URL's tab is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    onFrom(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);
  return null;
}
