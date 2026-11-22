// Formules d'abonnement. Les montants doivent rester identiques à ceux de la fonction cap-emploi-billing.
import type { Profile } from './types';

export type PlanId = 'free' | 'monthly' | 'pass';
export const PLANS: PlanId[] = ['free', 'monthly', 'pass'];
export const FREE_DOCS = 3;
export const PRICE_EUR: Record<PlanId, number> = { free: 0, monthly: 9.9, pass: 24 };

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLANS as string[]).includes(v);

/** Premium : accès offert, abonnement mensuel en cours ou Pass 3 mois valable (même règle que le serveur). */
export function isPremium(p: Pick<Profile, 'plan' | 'premium_until' | 'pass_until'>, now = Date.now()): boolean {
  return p.plan === 'premium' || [p.premium_until, p.pass_until].some((d) => !!d && new Date(d).getTime() > now);
}

/** Date jusqu'à laquelle Premium est acquis (la plus lointaine), ou null. */
export function premiumEnd(p: Pick<Profile, 'premium_until' | 'pass_until'>): string | null {
  const dates = [p.premium_until, p.pass_until].filter((d): d is string => !!d).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// Formule choisie à l'inscription : gardée jusqu'au premier passage par la page des tarifs.
const WANTED_KEY = 'cap.wantedPlan';
export function rememberWantedPlan(plan: PlanId) {
  try { if (plan === 'free') localStorage.removeItem(WANTED_KEY); else localStorage.setItem(WANTED_KEY, plan); } catch { /* stockage indisponible */ }
}
export function takeWantedPlan(metaPlan?: unknown, alreadyOffered = false): PlanId | null {
  let plan: unknown = null;
  try { plan = localStorage.getItem(WANTED_KEY); localStorage.removeItem(WANTED_KEY); } catch { /* idem */ }
  if (!plan && !alreadyOffered) plan = metaPlan;
  return isPlanId(plan) && plan !== 'free' ? plan : null;
}
