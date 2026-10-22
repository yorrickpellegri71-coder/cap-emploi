// @vitest-environment jsdom
// Test de fumée : chaque écran se rend sans erreur, dans les trois langues, avec un jeu de données minimal.
import { cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tables: Record<string, unknown[]> = {
  profiles: [{ id: 'u', display_name: 'Test', ui_lang: 'fr', doc_lang: 'fr', trade: 'hospitality', goals: { contacts: 5, applications: 3, followups: 5, posts: 1, training: 1, network: 1 },
    followup_days: 7, cv_text: 'CV', profile_data: { full_name: 'Test User', headline: 'Directeur', experiences: [{ title: 'Directeur', company: 'Hôtel', location: '', start: '2020', end: '', achievements: ['+12 %'] }], skills: ['Gestion'], languages: [{ language: 'Anglais', level: 'C1' }] },
    onboarded: true, consent_at: '2026-10-22T10:00:00Z', plan: 'free', opp_auto_prepare: true, opp_min_score: 75, opp_daily_email: false }],
  targets: [
    { id: 't1', company: 'Hôtel A', sector: 'Hôtel de luxe', priority: 'A', contact_name: 'Anne', contact_role: 'DG', channel: 'linkedin', stage: 'contacted', last_contact_on: '2026-10-01', job_url: '', notes: '',
      brief: { company: 'Hôtel A', job_title: 'Directeur', summary: 'Résumé', expectations: ['Gestion'], digital_idea: 'Tableau de bord', to_check: ['Nom du DG'], offer_text: 'Offre' }, created_at: '', updated_at: '' },
    { id: 't2', company: 'Resto B', sector: '', priority: 'B', contact_name: '', contact_role: '', channel: 'email', stage: 'todo', last_contact_on: null, job_url: '', notes: '', brief: {}, created_at: '', updated_at: '' },
  ],
  weeks: [{ counters: { contacts: 2 } }],
  modeles: [{ trade: '*', content: { first_contact: { subject: 'Objet {company}', body: 'Bonjour {contact}' }, followup: { subject: 's', body: 'b' }, thanks: { subject: 's', body: 'b' } } }],
  documents: [{ id: 'd1', target_id: null, company: 'Hôtel A', job_title: 'Directeur', lang: 'fr', offer_text: 'x', cv: '# Test\n## Expérience\n- point', letter: 'Madame,', email_subject: 'Candidature', email_body: 'Bonjour', pitch: 'Je suis', gaps: ['Allemand courant'], created_at: '2026-10-22T10:00:00Z' }],
  ai_usage: [{ documents: 1, extractions: 0 }],
  opportunities: [
    { id: 'o1', kind: 'job', title: 'Directeur', company: 'Hôtel C', location: 'Luxembourg', sector: 'Hôtel de luxe', source: 'jobs.lu', link: 'https://example.org', snippet: 'x', score: 86, reason: 'Expérience équivalente', status: 'to_validate', target_id: 't1', document_id: 'd1', found_at: '2026-10-22T06:00:00Z', updated_at: '' },
    { id: 'o2', kind: 'company', title: '', company: 'Groupe D', location: 'Luxembourg', sector: 'Groupe hôtelier', source: '', link: '', snippet: '', score: 72, reason: 'Secteur proche', status: 'new', target_id: null, document_id: null, found_at: '2026-10-22T06:00:00Z', updated_at: '' },
  ],
  applications: [
    { id: 'a1', target_id: 't1', document_id: null, opportunity_id: null, applied_on: '2026-10-20', company: 'Hôtel A', job_title: 'Chef de rang', source: 'jobs.lu', lang: 'fr', documents: ['email', 'letter', 'cv'], status: 'sent', followup_on: '2026-10-27', notes: '' },
    { id: 'a2', target_id: null, document_id: null, opportunity_id: null, applied_on: '2026-10-12', company: 'Traiteur B', job_title: '', source: 'channel:linkedin', lang: 'en', documents: ['email'], status: 'interview', followup_on: null, notes: 'RDV' },
  ],
  responses: [{ id: 'r1', application_id: 'a2', target_id: null, received_on: '2026-10-15', company: 'Traiteur B', job_title: '', type: 'interview', next_step: 'Entretien', next_step_on: '2026-10-25', notes: '' }],
  digests: [{ day: '2026-10-22', new_jobs: 1, new_companies: 1, prepared: 1, top: [{ id: 'o1', kind: 'job', title: 'Directeur', company: 'Hôtel C', score: 86, reason: 'x' }] }],
};

vi.mock('./lib/supabase', () => {
  const query = (table: string) => {
    let one = false;
    const result = () => ({ data: one ? (tables[table]?.[0] ?? null) : (tables[table] ?? []), error: null });
    const q: Record<string, unknown> = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') return () => { one = true; return q; };
        return () => q;
      },
    });
    return q;
  };
  const session = { user: { id: 'u', email: 'test@example.org' } };
  return {
    unwrap: (res: { data: unknown; error: { message: string } | null }) => { if (res.error) throw new Error(res.error.message); return res.data; },
    supabase: {
      from: query,
      rpc: (fn: string) => (fn === 'ensure_profile' ? query('profiles') : Promise.resolve({ data: {}, error: null })),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getSession: () => Promise.resolve({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  };
});

const ROUTES = ['/', '/opportunites', '/cibles', '/messages?cible=t1&type=followup', '/postuler', '/postuler?cible=t1', '/postuler?cible=t2', '/documents?cible=t1', '/profil', '/historique', '/historique?vue=reponses', '/confidentialite', '/inconnu'];

afterEach(cleanup);

describe.each(['fr', 'en', 'de'])('écrans (%s)', (lang) => {
  it.each(ROUTES)('%s se rend sans erreur', async (path) => {
    localStorage.setItem('cap.lang', lang);
    tables.profiles[0] = { ...(tables.profiles[0] as object), ui_lang: lang };
    window.scrollTo = () => undefined;
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    const { App } = await import('./App');
    const { SessionProvider } = await import('./lib/session');
    const { I18nProvider } = await import('./i18n');
    const { container } = render(
      <StrictMode><I18nProvider><MemoryRouter initialEntries={[path]}><SessionProvider><App /></SessionProvider></MemoryRouter></I18nProvider></StrictMode>,
    );
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 100));
    spy.mockRestore();
    expect(errors).toEqual([]);
    // Aucune clé de traduction brute ne doit apparaître à l'écran.
    expect(container.textContent).not.toMatch(/\b(week|targets|profile|apply|opps|messages|common|errors)\.[a-z]/);
  });
});
