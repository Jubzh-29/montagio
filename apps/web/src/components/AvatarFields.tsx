'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch } from '@/lib/api';
import { estimateSpeech, speechHint } from '@/lib/speech';
import styles from './studio.module.css';

/** The avatar's voice: the built-in one, or a sample uploaded with its speaker's consent. */
export type VoiceChoice = { mine: boolean; voiceRef: string | null; duration_s?: number; consent: boolean };
export const BUILT_IN_VOICE: VoiceChoice = { mine: false, voiceRef: null, consent: false };

function VoiceFields({ voice, onVoice }: { voice: VoiceChoice; onVoice: (voice: VoiceChoice) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const upload = async (file: File) => {
    setState('uploading');
    onVoice({ ...voice, voiceRef: null, consent: false });
    const form = new FormData();
    form.append('audio', file);
    const res = await apiFetch('/api/uploads/voice', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return setState('failed');
    const sample = (await res.json()) as { voiceRef: string; duration_s: number };
    setState('idle');
    onVoice({ mine: true, voiceRef: sample.voiceRef, duration_s: sample.duration_s, consent: false });
  };
  return (
    <>
      <div className={styles.canvasViews} role="group" aria-label={t('voiceLabel')}>
        <button type="button" className={styles.mode} aria-pressed={!voice.mine} onClick={() => onVoice(BUILT_IN_VOICE)}>
          {t('voiceBuiltIn')}
        </button>
        <button type="button" className={styles.mode} aria-pressed={voice.mine} onClick={() => onVoice({ ...voice, mine: true })}>
          {t('voiceMine')}
        </button>
      </div>
      {voice.mine && (
        <>
          <label className={styles.buttonSecondary} htmlFor="voice-input">
            {voice.voiceRef ? t('voiceReplace') : t('voiceUpload')}
          </label>
          <input
            id="voice-input"
            className="visually-hidden"
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <p className={styles.hint} role="status">
            {state === 'uploading'
              ? t('voiceUploading')
              : state === 'failed'
                ? t('voiceFailed')
                : voice.voiceRef
                  ? t('voiceReady', { s: Math.round(voice.duration_s ?? 0) })
                  : t('voiceHint')}
          </p>
          {voice.voiceRef && (
            <label className={styles.consent}>
              <input type="checkbox" checked={voice.consent} onChange={(event) => onVoice({ ...voice, consent: event.target.checked })} />
              <span>{t('voiceConsent')}</span>
            </label>
          )}
        </>
      )}
    </>
  );
}

/** Each spoken language by its own name: the header's EN | FR is the interface's language, not the avatar's. */
const LANGUAGES = [
  ['en', 'English'],
  ['fr', 'Français'],
] as const;

/** The Avatar tab's fields: what the photo says (300 characters at most), its language, and how long it may last. */
export function AvatarFields({
  text,
  language,
  max,
  onText,
  onLanguage,
  voice,
  onVoice,
}: {
  text: string;
  language: 'en' | 'fr';
  max: number;
  onText: (text: string) => void;
  onLanguage: (language: 'en' | 'fr') => void;
  voice: VoiceChoice;
  onVoice: (voice: VoiceChoice) => void;
}) {
  const { t } = useI18n();
  const seconds = estimateSpeech(text, language);
  const hint = speechHint(seconds);
  return (
    <div className={styles.panelSection}>
      <label htmlFor="avatar-text" className={styles.sectionTitle}>
        {t('avatarText')}
      </label>
      <textarea
        id="avatar-text"
        className={styles.prompt}
        rows={4}
        maxLength={max}
        value={text}
        placeholder={t('avatarTextPlaceholder')}
        aria-describedby="avatar-count avatar-duration"
        onChange={(event) => onText(event.target.value)}
      />
      <p id="avatar-count" className={styles.counter}>
        {t('charCount', { n: text.length, max })}
      </p>
      <div className={styles.canvasViews} role="group" aria-label={t('avatarLanguage')}>
        {LANGUAGES.map(([value, name]) => (
          <button key={value} type="button" className={styles.mode} lang={value} aria-pressed={language === value} onClick={() => onLanguage(value)}>
            {name}
          </button>
        ))}
      </div>
      <p id="avatar-duration" className={styles.hint}>
        {seconds > 0 && t('avatarDuration', { s: seconds })}
      </p>
      {hint && (
        <p className={styles.hint} role="status">
          {t(hint === 'too-long' ? 'avatarTooLongHint' : 'avatarTooShortHint')}
        </p>
      )}
      <VoiceFields voice={voice} onVoice={onVoice} />
    </div>
  );
}
