import { describe, expect, it } from 'vitest';
import { isPremium, premiumEnd } from './plans';

const base = { plan: 'free' as const, premium_until: null, pass_until: null };
const now = Date.parse('2026-11-22T12:00:00Z');

describe('formules', () => {
  it('gratuit par défaut', () => expect(isPremium(base, now)).toBe(false));
  it('accès offert', () => expect(isPremium({ ...base, plan: 'premium' }, now)).toBe(true));
  it('abonnement en cours ou expiré', () => {
    expect(isPremium({ ...base, premium_until: '2026-12-01T00:00:00Z' }, now)).toBe(true);
    expect(isPremium({ ...base, premium_until: '2026-11-01T00:00:00Z' }, now)).toBe(false);
  });
  it('pass valable', () => expect(isPremium({ ...base, pass_until: '2027-02-22T00:00:00Z' }, now)).toBe(true));
  it('date de fin la plus lointaine', () =>
    expect(premiumEnd({ premium_until: '2026-12-01T00:00:00Z', pass_until: '2027-02-22T00:00:00Z' })).toBe('2027-02-22T00:00:00Z'));
});
