// Accès aux données. La sécurité par utilisateur est garantie côté base (RLS) : aucune requête ne filtre « à la main ».
import { stageEffect, isoDay, isoWeek } from './dates';
import { supabase, unwrap } from './supabase';
import type { CompanyBrief, CounterKey, Counters, Digest, DocumentRow, JobResult, Lang, MessageTemplates, Opportunity, OppStatus, ProfileData, Stage, Target } from './types';

export async function fetchTargets(): Promise<Target[]> {
  return unwrap(await supabase.from('targets').select('*').order('updated_at', { ascending: false })) as Target[];
}

export type TargetInput = Omit<Target, 'id' | 'created_at' | 'updated_at'>;

export async function saveTarget(input: TargetInput, id?: string): Promise<Target> {
  const q = id ? supabase.from('targets').update(input).eq('id', id) : supabase.from('targets').insert(input);
  return unwrap(await q.select().single()) as Target;
}

export async function deleteTarget(id: string): Promise<void> {
  unwrap(await supabase.from('targets').delete().eq('id', id).select('id'));
}

export async function bumpCounter(key: CounterKey, delta: number, week = isoWeek()): Promise<Counters> {
  return unwrap(await supabase.rpc('bump_counter', { p_week: week, p_key: key, p_delta: delta })) as Counters;
}

/** Change l'étape d'une cible et applique les règles : date du jour, compteur de la semaine. */
export async function moveTarget(target: Target, stage: Stage): Promise<Target> {
  const effect = stageEffect(target.stage, stage);
  const patch: Partial<Target> = { stage };
  if (effect.touch) patch.last_contact_on = isoDay();
  const row = unwrap(await supabase.from('targets').update(patch).eq('id', target.id).select().single()) as Target;
  if (effect.counter) await bumpCounter(effect.counter, 1);
  return row;
}

/** « J'ai envoyé » : la cible passe en « Contacté », la candidature est comptée, la relance part du jour. */
export async function markApplied(target: Target): Promise<Target> {
  const stage: Stage = ['todo', 'contacted', 'followed_up'].includes(target.stage) ? 'contacted' : target.stage;
  const row = unwrap(await supabase.from('targets').update({ stage, last_contact_on: isoDay() }).eq('id', target.id).select().single()) as Target;
  await bumpCounter('applications', 1);
  return row;
}

/** Crée la cible d'une fiche entreprise, ou met à jour la cible existante du même nom. */
export async function upsertTargetFromBrief(brief: CompanyBrief, targets: Target[], jobUrl: string): Promise<Target> {
  const name = (brief.company ?? '').trim();
  const existing = targets.find((x) => x.company.trim().toLowerCase() === name.toLowerCase());
  if (existing) {
    const patch: Partial<Target> = { brief };
    if (!existing.sector && brief.sector) patch.sector = brief.sector;
    if (!existing.contact_name && brief.contact_name) { patch.contact_name = brief.contact_name; patch.contact_role = brief.contact_role ?? ''; }
    if (!existing.job_url && jobUrl) patch.job_url = jobUrl;
    return unwrap(await supabase.from('targets').update(patch).eq('id', existing.id).select().single()) as Target;
  }
  return saveTarget({
    company: name, sector: brief.sector ?? '', priority: 'A', contact_name: brief.contact_name ?? '', contact_role: brief.contact_role ?? '',
    channel: jobUrl ? 'jobboard' : 'email', stage: 'todo', last_contact_on: null, job_url: jobUrl, notes: brief.job_title ? `${brief.job_title}` : '', brief,
  });
}

export async function fetchWeek(week: string): Promise<Counters> {
  const row = unwrap(await supabase.from('weeks').select('counters').eq('week', week).maybeSingle()) as { counters: Counters } | null;
  return row?.counters ?? {};
}

export async function fetchSectors(trade: string, lang: Lang): Promise<string[]> {
  const row = unwrap(await supabase.from('modeles').select('content').eq('trade', trade).eq('lang', lang).eq('kind', 'sectors').maybeSingle()) as { content: string[] } | null;
  return row?.content ?? [];
}

export async function fetchMessages(lang: Lang, trade: string): Promise<MessageTemplates | null> {
  // Modèle propre au métier s'il existe, sinon le modèle commun.
  const rows = unwrap(await supabase.from('modeles').select('trade, content').eq('lang', lang).eq('kind', 'messages').in('trade', [trade, '*'])) as { trade: string; content: MessageTemplates }[];
  return (rows.find((r) => r.trade === trade) ?? rows.find((r) => r.trade === '*'))?.content ?? null;
}

export async function fetchDocuments(): Promise<DocumentRow[]> {
  return unwrap(await supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(50)) as DocumentRow[];
}

export async function updateDocument(id: string, patch: Partial<Pick<DocumentRow, 'cv' | 'letter' | 'email_subject' | 'email_body' | 'pitch'>>): Promise<void> {
  unwrap(await supabase.from('documents').update(patch).eq('id', id).select('id'));
}

export async function deleteDocument(id: string): Promise<void> {
  unwrap(await supabase.from('documents').delete().eq('id', id).select('id'));
}

export async function fetchUsage(): Promise<{ documents: number; extractions: number; briefs: number }> {
  const month = new Date().toISOString().slice(0, 7);
  const row = unwrap(await supabase.from('ai_usage').select('documents, extractions, briefs').eq('month', month).maybeSingle()) as { documents: number; extractions: number; briefs: number } | null;
  return row ?? { documents: 0, extractions: 0, briefs: 0 };
}

/** Erreur de la fonction IA, avec un code stable traduit par l'interface (errors.ai.<code>). */
export class AiError extends Error {
  constructor(public code: string) { super(code); }
}

async function callAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) {
    let code = 'server_error';
    const ctx = (error as { context?: Response }).context;
    try { code = (await ctx?.json())?.error ?? code; } catch { /* réponse non JSON */ }
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) code = 'network';
    throw new AiError(code);
  }
  return data as T;
}

export const extractProfile = (input: { cv_text?: string; pdf_base64?: string }) =>
  callAi<{ profile: ProfileData & { cv_text: string } }>({ action: 'extract', ...input });

export const tailorDocuments = (input: { offer_text: string; lang: Lang; target_id?: string | null }) =>
  callAi<{ document: DocumentRow; remaining: number | null }>({ action: 'tailor', ...input });

export const companyBrief = (input: { company?: string; offer_text?: string; job_url?: string; lang: Lang }) =>
  callAi<{ brief: CompanyBrief }>({ action: 'brief', ...input });

export const searchJobs = (input: { keywords: string; location?: string; page?: number }) =>
  callAi<{ total: number; jobs: JobResult[] }>({ action: 'search_jobs', ...input });

// ───────────── Opportunités ─────────────

export async function fetchOpportunities(): Promise<Opportunity[]> {
  return unwrap(await supabase.from('opportunities').select('*').neq('status', 'dismissed').order('score', { ascending: false }).limit(200)) as Opportunity[];
}

export async function setOpportunityStatus(ids: string[], status: OppStatus): Promise<void> {
  if (ids.length) unwrap(await supabase.from('opportunities').update({ status }).in('id', ids).select('id'));
}

export async function fetchLatestDigest(): Promise<Digest | null> {
  return unwrap(await supabase.from('digests').select('*').order('day', { ascending: false }).limit(1).maybeSingle()) as Digest | null;
}

export async function fetchDocument(id: string): Promise<DocumentRow> {
  return unwrap(await supabase.from('documents').select('*').eq('id', id).single()) as DocumentRow;
}

export const discoverOpportunities = () => callAi<{ inserted: number; toPrepare: string[]; jobsEnabled: boolean }>({ action: 'discover' });

export const prepareOpportunity = (id: string, lang?: Lang) =>
  callAi<{ opportunity: Opportunity; document?: DocumentRow }>({ action: 'prepare', opportunity_id: id, lang });

/** Lien mailto prérempli : l'utilisateur choisit le destinataire et joint ses fichiers, puis envoie lui-même. */
export function mailtoLink(doc: Pick<DocumentRow, 'email_subject' | 'email_body'>, to = ''): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(doc.email_subject)}&body=${encodeURIComponent(doc.email_body)}`;
}

/** Export RGPD : toutes les données du compte en JSON. */
export async function exportMyData(): Promise<Blob> {
  const [profile, targets, weeks, documents, usage, opportunities, digests] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase.from('targets').select('*'),
    supabase.from('weeks').select('*'),
    supabase.from('documents').select('*'),
    supabase.from('ai_usage').select('*'),
    supabase.from('opportunities').select('*'),
    supabase.from('digests').select('*'),
  ]);
  const data = {
    exported_at: new Date().toISOString(), profile: unwrap(profile), targets: unwrap(targets), weeks: unwrap(weeks), documents: unwrap(documents),
    ai_usage: unwrap(usage), opportunities: unwrap(opportunities), digests: unwrap(digests),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export async function deleteMyAccount(): Promise<void> {
  unwrap(await supabase.rpc('delete_my_account'));
  await supabase.auth.signOut();
}
