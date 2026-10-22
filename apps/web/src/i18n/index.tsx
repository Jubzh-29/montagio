'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import en from './en.json';
import fr from './fr.json';
import { CATALOG_FR } from './catalog-fr';

export type Lang = 'en' | 'fr';
export type MessageKey = keyof typeof en;

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, fr };
const STORAGE_KEY = 'lang';

export function t(key: MessageKey, lang: Lang, vars: Record<string, string | number> = {}): string {
  const template = DICTIONARIES[lang][key] ?? DICTIONARIES.en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

/** A camera move's, an effect's or a hook's name in the interface's language; strings only, so a caller's state stays its own. */
export function catalogName(lang: Lang, id: string, english: string): string {
  return (lang === 'fr' ? CATALOG_FR[id]?.name : undefined) ?? english;
}

/** A camera move's, an effect's or a hook's name and description in the interface's language (English: its YAML file's). */
export function catalogText(lang: Lang, item: { id: string; name: string; description?: string }): { name: string; description: string } {
  const french = lang === 'fr' ? CATALOG_FR[item.id] : undefined;
  return { name: french?.name ?? item.name, description: french?.description ?? item.description ?? '' };
}

// The chosen language lives in localStorage; the server always renders English.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: (key: MessageKey, vars?: Record<string, string | number>) => string };

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => 'en' as Lang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable (private mode): the choice lasts for this page only
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => t(key, lang, vars) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}
