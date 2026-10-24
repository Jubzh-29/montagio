'use client';

import type { Recipe } from '@montagio/recipe';
import { sameWorkflows } from '@montagio/recipe/same';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import { recipeRows, weightRows } from '@/lib/recipe-view';
import styles from './recipe.module.css';

type Loaded = { status: 'idle' | 'loading' | 'failed' } | { status: 'ready'; recipe: Recipe; same?: boolean };

/**
 * Under a result: its recipe, read on first opening. Everything that made it (preset, model, seed,
 * settings, input by sha256, workflow by sha256, weight files and versions), with the JSON to download
 * and Reproduce. `compareUrl`, the recipe of the result it reproduces, opens it at once and says
 * whether the workflow is the same.
 */
export function RecipePanel({
  url,
  downloadHref = `${url}?download=1`,
  reproduceHref,
  homeHref,
  compareUrl,
}: {
  url: string;
  downloadHref?: string;
  reproduceHref?: string;
  homeHref?: string;
  compareUrl?: string;
}) {
  const { t, lang } = useI18n();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'idle' });
  const details = useRef<HTMLDetailsElement>(null);

  const load = useCallback(() => {
    setLoaded({ status: 'loading' });
    Promise.all([
      apiFetch(url).then((res) => jsonOrThrow<Recipe>(res)),
      compareUrl ? apiFetch(compareUrl).then((res) => jsonOrThrow<Recipe>(res)).catch(() => null) : null,
    ])
      .then(([recipe, original]) => setLoaded({ status: 'ready', recipe, ...(original ? { same: sameWorkflows(original, recipe) } : {}) }))
      .catch(() => setLoaded({ status: 'failed' }));
  }, [url, compareUrl]);

  // A reproduction says at once whether it ran the same workflow: it opens, which loads it.
  useEffect(() => {
    if (compareUrl && details.current) details.current.open = true;
  }, [compareUrl]);

  const onToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && (loaded.status === 'idle' || loaded.status === 'failed')) load();
  };

  return (
    <details ref={details} className={styles.panel} data-testid="recipe-panel" onToggle={onToggle}>
      <summary className={styles.summary}>
        <span className={styles.title}>{t('recipeTitle')}</span>
        <span className={styles.hint}>{t('recipeHint')}</span>
      </summary>
      <div className={styles.body}>
        {loaded.status === 'loading' && <p className={styles.note}>{t('recipeLoading')}</p>}
        {loaded.status === 'failed' && (
          <p className={styles.note} role="alert">
            {t('recipeFailed')}
          </p>
        )}
        {loaded.status === 'ready' && (
          <>
            {loaded.same !== undefined && (
              <p className={styles.verdict} data-same={loaded.same} data-testid="recipe-compare" role="status">
                {t(loaded.same ? 'recipeSame' : 'recipeDiffers')}
              </p>
            )}
            <dl className={styles.rows}>
              {recipeRows(loaded.recipe, lang).map((row, index) => (
                <div key={`${row.key}-${index}`} className={styles.row}>
                  <dt>{t(row.key)}</dt>
                  <dd className={row.mono ? styles.mono : undefined}>{row.valueKey ? t(row.valueKey) : row.value}</dd>
                </div>
              ))}
            </dl>
            <h3 className={styles.subtitle}>{t('recipeWeights')}</h3>
            <ul className={styles.weights}>
              {weightRows(loaded.recipe).map((weight) => (
                <li key={weight.id} data-testid="recipe-weight">
                  <Link href={weight.href} className={styles.weightId} title={weight.file}>
                    {weight.id}
                  </Link>
                  <span>{weight.license}</span>
                  {weight.sha256 && <span className={styles.mono}>{weight.sha256}</span>}
                </li>
              ))}
            </ul>
            {loaded.recipe.backend === 'demo' && <p className={styles.note}>{t('recipeDemo')}</p>}
          </>
        )}
        <p className={styles.note}>{t('recipeHonesty')}</p>
        <div className={styles.actions}>
          <a className={styles.action} href={downloadHref} download data-testid="recipe-download">
            {t('recipeDownload')}
            <span className={styles.fileTag}>.json</span>
          </a>
          {reproduceHref && (
            <Link className={styles.action} href={reproduceHref} data-testid="recipe-reproduce">
              {t('recipeReproduce')}
            </Link>
          )}
          {homeHref && (
            <a className={styles.action} href={homeHref} data-testid="recipe-home">
              {t('recipeReproduceHome')}
            </a>
          )}
        </div>
      </div>
    </details>
  );
}
