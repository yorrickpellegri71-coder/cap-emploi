// Traductions : un fichier JSON par langue (fr, en, de, lb, pt). Ajouter une langue = ajouter un fichier et l'entrée dans DICTS.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CONTENT_LANG, UI_LANGS, type Lang, type UiLang } from '../lib/types';
import de from './de.json';
import en from './en.json';
import fr from './fr.json';
import lb from './lb.json';
import pt from './pt.json';

type Dict = { [k: string]: string | Dict };
export const DICTS: Record<UiLang, Dict> = { fr, en, de, lb, pt };
const STORE_KEY = 'cap.lang';

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function translate(lang: UiLang, key: string, vars?: Record<string, string | number>): string {
  const find = (d: Dict) => key.split('.').reduce<string | Dict | undefined>((n, k) => (typeof n === 'object' ? n[k] : undefined), d);
  let s = find(DICTS[lang]);
  if (typeof s !== 'string') s = find(DICTS.fr);
  if (typeof s !== 'string') return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
}

const isUiLang = (v: unknown): v is UiLang => typeof v === 'string' && (UI_LANGS as string[]).includes(v);

function initialLang(): UiLang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isUiLang(saved)) return saved;
  } catch { /* stockage indisponible */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
  return isUiLang(nav) ? nav : 'fr';
}

// lang : langue de l'interface. contentLang : langue des contenus servis par la base (fr, en ou de).
interface Ctx { lang: UiLang; contentLang: Lang; setLang: (l: UiLang) => void; t: TFn; locale: string }
const I18nContext = createContext<Ctx | null>(null);
const LOCALES: Record<UiLang, string> = { fr: 'fr-LU', en: 'en-GB', de: 'de-LU', lb: 'de-LU', pt: 'pt-PT' }; // dates en luxembourgeois : format allemand, les navigateurs ne connaissent pas toujours lb

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(initialLang);
  const setLang = useCallback((l: UiLang) => {
    setLangState(l);
    try { localStorage.setItem(STORE_KEY, l); } catch { /* idem */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, contentLang: CONTENT_LANG[lang], setLang, t, locale: LOCALES[lang] }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nProvider manquant');
  return ctx;
}
