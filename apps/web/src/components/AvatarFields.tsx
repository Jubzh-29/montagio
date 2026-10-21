'use client';

import { useI18n } from '@/i18n';
import { estimateSpeech, speechHint } from '@/lib/speech';
import styles from './studio.module.css';

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
}: {
  text: string;
  language: 'en' | 'fr';
  max: number;
  onText: (text: string) => void;
  onLanguage: (language: 'en' | 'fr') => void;
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
    </div>
  );
}
