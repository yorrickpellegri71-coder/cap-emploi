// Traductions : un fichier JSON par langue (fr, en, de). Ajouter une langue = ajouter un fichier et l'entrée dans DICTS.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../lib/types';
import de from './de.json';
import en from './en.json';
import fr from './fr.json';

type Dict = { [k: string]: string | Dict };
export const DICTS: Record<Lang, Dict> = { fr, en, de };
const STORE_KEY = 'cap.lang';

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const find = (d: Dict) => key.split('.').reduce<string | Dict | undefined>((n, k) => (typeof n === 'object' ? n[k] : undefined), d);
  let s = find(DICTS[lang]);
  if (typeof s !== 'string') s = find(DICTS.fr);
  if (typeof s !== 'string') return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'fr' || saved === 'en' || saved === 'de') return saved;
  } catch { /* stockage indisponible */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
  return nav === 'en' || nav === 'de' ? nav : 'fr';
}

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: TFn; locale: string }
const I18nContext = createContext<Ctx | null>(null);
const LOCALES: Record<Lang, string> = { fr: 'fr-LU', en: 'en-GB', de: 'de-LU' };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORE_KEY, l); } catch { /* idem */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, locale: LOCALES[lang] }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nProvider manquant');
  return ctx;
}
