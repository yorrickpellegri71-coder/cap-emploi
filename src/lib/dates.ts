// Calculs de dates et règles du pipeline (couverts par dates.test.ts).
import type { Stage, Target } from './types';

/** Date locale au format AAAA-MM-JJ. */
export function isoDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Semaine ISO 8601 (lundi au dimanche) : 2026-W43. */
export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Lundi de la semaine ISO donnée. */
export function weekMonday(week: string): Date {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (w - 1) * 7);
  return monday;
}

export function shiftWeek(week: string, delta: number): string {
  const d = weekMonday(week);
  d.setDate(d.getDate() + delta * 7);
  return isoWeek(d);
}

/** Jours entiers écoulés entre deux dates AAAA-MM-JJ. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const WAITING: Stage[] = ['contacted', 'followed_up'];

/** Cibles contactées ou relancées sans nouvelle depuis `days` jours ou plus, la plus ancienne en premier. */
export function dueFollowups(targets: Target[], days: number, today = isoDay()): Target[] {
  return targets
    .filter((t) => WAITING.includes(t.stage) && t.last_contact_on && daysBetween(t.last_contact_on, today) >= days)
    .sort((a, b) => (a.last_contact_on! < b.last_contact_on! ? -1 : 1));
}

/** Effet d'un changement d'étape : date du dernier contact et compteur à incrémenter. */
export function stageEffect(from: Stage, to: Stage): { touch: boolean; counter: 'contacts' | 'followups' | null } {
  if (from === 'todo' && to === 'contacted') return { touch: true, counter: 'contacts' };
  if (to === 'followed_up' && from !== 'followed_up') return { touch: true, counter: 'followups' };
  if (to === 'interview' && from !== 'interview') return { touch: true, counter: null };
  return { touch: false, counter: null };
}

/** Remplit un modèle de message : {contact}, {company}, {me}, {headline}. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m));
}
