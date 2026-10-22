// Métiers visés : un profil peut en viser plusieurs (hôtellerie et métiers voisins où son parcours se transpose).
import keywords from './tradeKeywords.json';
import { TRADES, type Lang, type Profile } from './types';

const KEYWORDS = keywords as Record<string, Record<Lang, string[]>>;

/** Métiers visés du profil, dans l'ordre choisi ; le premier sert aux modèles de messages. */
export function targetTrades(p: Pick<Profile, 'trade' | 'target_trades'>): string[] {
  const list = (p.target_trades ?? []).filter((x) => (TRADES as readonly string[]).includes(x));
  return list.length ? list : [p.trade || 'general'];
}

/** Idées de recherche des métiers visés, prises à tour de rôle dans chaque métier, sans doublon. */
export function searchIdeas(trades: string[], lang: Lang, max = 12): string[] {
  const lists = trades.map((tr) => KEYWORDS[tr]?.[lang] ?? []);
  const out = new Set<string>();
  for (let i = 0; out.size < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.size < max) out.add(l[i]);
  }
  return [...out];
}
