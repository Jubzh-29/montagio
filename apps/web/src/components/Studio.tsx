'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  TERMINAL_STATES,
  type GenerationRecord,
  type ModelSummary,
  type PresetSummary,
  type UploadResult,
} from '@/lib/api-types';
import { Header } from './Header';
import { ModelPicker } from './ModelPicker';
import { Monitor, type GenerationState, type UploadState } from './Monitor';
import { PresetGallery } from './PresetGallery';
import styles from './studio.module.css';

const POLL_MS = 1000;

export function Studio() {
  const { t } = useI18n();
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const submitting = useRef(false);
  const localUrlRef = useRef<string | undefined>(undefined);

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
      .catch(() => setGeneration({ status: 'error', message: t('errorGeneric') }));
    // t only changes with the language; the catalog is fetched once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  const record = generation.status === 'tracking' ? generation.record : undefined;
  const busy =
    generation.status === 'submitting' || (record !== undefined && !TERMINAL_STATES.has(record.state));

  // Poll the current generation until it reaches a terminal state.
  useEffect(() => {
    if (!record || TERMINAL_STATES.has(record.state)) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/generations/${record.id}`);
        if (res.ok) setGeneration({ status: 'tracking', record: (await res.json()) as GenerationRecord });
      } catch {
        setGeneration({ status: 'tracking', record: { ...record } });
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [record]);

  const onFile = useCallback(
    async (file: File) => {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      const localUrl = URL.createObjectURL(file);
      localUrlRef.current = localUrl;
      setGeneration({ status: 'idle' });
      setUpload({ status: 'uploading', localUrl });
      const form = new FormData();
      form.set('image', file);
      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: form });
        if (res.status === 413) return setUpload({ status: 'error', message: t('errorUpload413') });
        if (res.status === 415) return setUpload({ status: 'error', message: t('errorUpload415') });
        if (!res.ok) return setUpload({ status: 'error', message: t('errorGeneric') });
        const result = (await res.json()) as UploadResult;
        setUpload({ status: 'ready', localUrl, imageRef: result.imageRef });
      } catch {
        setUpload({ status: 'error', message: t('errorGeneric') });
      }
    },
    [t],
  );

  const loadSample = async () => {
    const res = await fetch('/media/demo-assets/images/sample-16x9.png');
    if (!res.ok) return setUpload({ status: 'error', message: t('errorGeneric') });
    await onFile(new File([await res.blob()], 'sample.png', { type: 'image/png' }));
  };

  const canGenerate = upload.status === 'ready' && presetId !== null && modelId !== null && !busy;

  const generate = async () => {
    if (submitting.current || !canGenerate || upload.status !== 'ready') return;
    submitting.current = true;
    setGeneration({ status: 'submitting' });
    try {
      const res = await fetch('/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ presetId, modelId, imageRef: upload.imageRef, userPrompt: prompt.trim() || undefined }),
      });
      if (!res.ok) {
        setGeneration({ status: 'error', message: t('errorGeneric') });
        return;
      }
      setGeneration({ status: 'tracking', record: (await res.json()) as GenerationRecord });
    } catch {
      setGeneration({ status: 'error', message: t('errorGeneric') });
    } finally {
      submitting.current = false;
    }
  };

  const cancel = async () => {
    if (!record) return;
    const res = await fetch(`/api/generations/${record.id}/cancel`, { method: 'POST' });
    if (res.ok) setGeneration({ status: 'tracking', record: (await res.json()) as GenerationRecord });
  };

  const selectedModel = models.find((model) => model.id === modelId);
  const estimate = selectedModel?.estimate_s['480p'] ?? 0;

  return (
    <>
      <Header recording={busy} />
      <main className={styles.studio}>
        <section className={styles.stage} aria-label="Monitor">
          <Monitor
            upload={upload}
            generation={generation}
            onFile={onFile}
            onSample={loadSample}
            onCancel={cancel}
            onRetry={() => setGeneration({ status: 'idle' })}
          />
          {record?.state === 'succeeded' && (
            <div className={styles.actions}>
              {record.outputUrl && (
                <a className={styles.buttonSecondary} href={record.outputUrl} download>
                  {t('download')}
                </a>
              )}
              <a className={styles.buttonSecondary} href={`/api/workflows/${record.id}`} download>
                {t('openInComfy')}
              </a>
              <a className={styles.buttonSecondary} href={`/api/presets/${record.presetId}/yaml`} download>
                {t('remix')}
              </a>
            </div>
          )}
        </section>

        <aside className={styles.panel}>
          <PresetGallery presets={presets} selectedId={presetId} onSelect={setPresetId} />
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
              {t('generate', { s: estimate })}
            </button>
            {upload.status !== 'ready' && <p className={styles.hint}>{t('generateHint')}</p>}
            <p className={styles.note}>{t('localNote')}</p>
          </div>
        </aside>
      </main>
    </>
  );
}
