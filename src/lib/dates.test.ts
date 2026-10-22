import { describe, expect, it } from 'vitest';
import { daysBetween, dueFollowups, fillTemplate, isoWeek, shiftWeek, stageEffect, weekMonday } from './dates';
import type { Target } from './types';

const t = (id: string, stage: Target['stage'], last: string | null): Target => ({
  id, company: id, sector: '', priority: 'B', contact_name: '', contact_role: '', channel: 'email', stage,
  last_contact_on: last, job_url: '', notes: '', brief: {}, created_at: '', updated_at: '',
});

describe('semaines ISO', () => {
  it('calcule la semaine ISO', () => {
    expect(isoWeek(new Date(2026, 9, 22))).toBe('2026-W43');
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeek(new Date(2025, 11, 29))).toBe('2026-W01');
  });
  it('retrouve le lundi et navigue', () => {
    const m = weekMonday('2026-W43');
    expect([m.getFullYear(), m.getMonth(), m.getDate()]).toEqual([2026, 9, 19]);
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    expect(shiftWeek('2026-W01', -1)).toBe('2025-W52');
  });
});

describe('relances', () => {
  it('liste les cibles en attente depuis le délai, la plus ancienne en premier', () => {
    const list = [t('a', 'contacted', '2026-10-15'), t('b', 'followed_up', '2026-10-01'), t('c', 'contacted', '2026-10-20'),
      t('d', 'interview', '2026-09-01'), t('e', 'todo', null)];
    expect(dueFollowups(list, 7, '2026-10-22').map((x) => x.id)).toEqual(['b', 'a']);
    expect(dueFollowups(list, 10, '2026-10-22').map((x) => x.id)).toEqual(['b']);
  });
  it('compte les jours', () => expect(daysBetween('2026-10-15', '2026-10-22')).toBe(7));
});

describe('règles du pipeline', () => {
  it('à contacter → contacté : date et compteur de contacts', () => expect(stageEffect('todo', 'contacted')).toEqual({ touch: true, counter: 'contacts' }));
  it('relance : compteur de relances', () => expect(stageEffect('contacted', 'followed_up')).toEqual({ touch: true, counter: 'followups' }));
  it('pas retenu : rien', () => expect(stageEffect('contacted', 'rejected')).toEqual({ touch: false, counter: null }));
});

describe('modèles', () => {
  it('remplit les variables connues et garde les autres', () => {
    expect(fillTemplate('Bonjour {contact}, {company} {x}', { contact: 'Anne', company: 'Hôtel', x: '' })).toBe('Bonjour Anne, Hôtel {x}');
  });
});
