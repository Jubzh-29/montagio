'use client';

import { useI18n } from '@/i18n';
import styles from './studio.module.css';

/** Under every result: what made it, and that it is AI-generated (the AI Act's visible mention). */
export function AiCaption({ modelName, license }: { modelName: string; license: string }) {
  const { t } = useI18n();
  return (
    <p className={styles.caption} data-testid="ai-caption">
      {t('aiCaption', { model: modelName, license })}
    </p>
  );
}
