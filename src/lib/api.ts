// Accès aux données. La sécurité par utilisateur est garantie côté base (RLS) : aucune requête ne filtre « à la main ».
import { stageEffect, isoDay, isoWeek } from './dates';
import { supabase, unwrap } from './supabase';
import type { Profile, Application, AppStatus, OfferCheck, OfferOrigin, ReceivedOffer, ResponseRow, ResponseType, CompanyBrief, CounterKey, Counters, Digest, DocumentRow, JobResult, Lang, MessageTemplates, Opportunity, OppStatus, ProfileData, Stage, Target } from './types';

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
  // Relance : la dernière candidature de la cible passe en « Relancée ».
  if (stage === 'followed_up') await syncLatestApplication(target.id, { status: 'followed_up', followup_on: null });
  if (stage === 'interview' || stage === 'offer' || stage === 'rejected') await syncLatestApplication(target.id, { status: stage });
  return row;
}

async function syncLatestApplication(targetId: string, patch: Partial<Application>) {
  const latest = unwrap(await supabase.from('applications').select('id').eq('target_id', targetId).order('applied_on', { ascending: false }).limit(1).maybeSingle()) as { id: string } | null;
  if (latest) unwrap(await supabase.from('applications').update(patch).eq('id', latest.id).select('id'));
}

export interface AppliedInfo { document?: DocumentRow | null; source?: string; jobTitle?: string; opportunityId?: string; followupDays: number }

/** Pièces réellement présentes dans un dossier. */
export const piecesOf = (d?: DocumentRow | null) =>
  d ? (['email', 'letter', 'cv', 'pitch'] as const).filter((k) => (k === 'email' ? d.email_body : d[k]).trim()) : [];

/** « J'ai envoyé » : la cible passe en « Contacté », la candidature est comptée et inscrite à l'historique, la relance part du jour. */
export async function markApplied(target: Target, info: AppliedInfo): Promise<Target & { application_id: string }> {
  const stage: Stage = ['todo', 'contacted', 'followed_up'].includes(target.stage) ? 'contacted' : target.stage;
  const today = isoDay();
  const row = unwrap(await supabase.from('targets').update({ stage, last_contact_on: today }).eq('id', target.id).select().single()) as Target;
  const follow = new Date(`${today}T12:00:00`);
  follow.setDate(follow.getDate() + info.followupDays);
  let source = info.source ?? '';
  if (!source && target.job_url) { try { source = new URL(target.job_url).hostname.replace(/^www\./, ''); } catch { /* lien invalide */ } }
  const app = unwrap(await supabase.from('applications').insert({
    target_id: target.id, document_id: info.document?.id ?? null, opportunity_id: info.opportunityId ?? null, applied_on: today,
    company: target.company, job_title: info.jobTitle ?? info.document?.job_title ?? target.brief?.job_title ?? '',
    source: source || `channel:${target.channel}`, lang: info.document?.lang ?? 'fr', documents: piecesOf(info.document),
    status: 'sent', followup_on: isoDay(follow),
  }).select('id').single()) as { id: string };
  await bumpCounter('applications', 1);
  return { ...row, application_id: app.id };
}

/** Dossier sans IA (mode gratuit) : assemblé à partir du profil, enregistré comme un dossier ordinaire. */
export async function createTemplateDocument(target: Target, profile: Profile, lang: Lang, jobTitle: string, offerText: string): Promise<DocumentRow> {
  const { buildDossier } = await import('./templateDossier');
  const pieces = buildDossier({
    company: target.company, jobTitle, contact: target.contact_name, lang, profile: profile.profile_data, displayName: profile.display_name,
  });
  return unwrap(await supabase.from('documents').insert({
    target_id: target.id, company: target.company, job_title: jobTitle.slice(0, 200), lang, offer_text: offerText.slice(0, 30000), ...pieces,
  }).select().single()) as DocumentRow;
}

// ───────────── Offres reçues ─────────────

export async function fetchReceivedOffers(): Promise<ReceivedOffer[]> {
  return unwrap(await supabase.from('received_offers').select('*').neq('status', 'dismissed').order('received_at', { ascending: false }).limit(300)) as ReceivedOffer[];
}

/** Nombre d'offres reçues pas encore ouvertes (alerte et compteur). */
export async function countNewOffers(): Promise<number> {
  const { count, error } = await supabase.from('received_offers').select('id', { count: 'exact', head: true }).is('seen_at', null).neq('status', 'dismissed');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface ManualOffer { title: string; company: string; location: string; link: string; source: string; offer_text: string }
export async function addManualOffer(o: ManualOffer): Promise<ReceivedOffer> {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const dedupe_key = o.link ? `link:${o.link.split('#')[0]}` : `text:${norm(`${o.title} ${o.company}`)} ${Date.now()}`;
  return unwrap(await supabase.from('received_offers').insert({ ...o, origin: 'manual', dedupe_key }).select().single()) as ReceivedOffer;
}

export async function updateReceivedOffer(id: string, patch: Partial<ReceivedOffer>): Promise<ReceivedOffer> {
  return unwrap(await supabase.from('received_offers').update(patch).eq('id', id).select().single()) as ReceivedOffer;
}

/** Coche ou décoche une case de la liste de vérification (horodatée). */
export function setOfferCheck(offer: ReceivedOffer, key: OfferCheck, on: boolean) {
  const checks = { ...offer.checks };
  if (on) checks[key] = new Date().toISOString(); else delete checks[key];
  return updateReceivedOffer(offer.id, { checks });
}

export const analyzeOffer = (offerId: string, lang?: Lang) => callAi<{ offer: ReceivedOffer }>({ action: 'analyze_offer', offer_id: offerId, lang });

export interface AlertEmail { from: string; subject: string; date: string; text: string }
export const importAlerts = (origin: Exclude<OfferOrigin, 'collected' | 'manual'>, emails: AlertEmail[]) =>
  callAi<{ inserted: number }>({ action: 'import_alerts', origin, emails });

// ───────────── Historiques ─────────────

export async function fetchApplications(): Promise<Application[]> {
  return unwrap(await supabase.from('applications').select('*').order('applied_on', { ascending: false }).limit(1000)) as Application[];
}

export type ApplicationInput = Omit<Application, 'id' | 'document_id' | 'opportunity_id'>;
export async function saveApplication(input: ApplicationInput, id?: string): Promise<Application> {
  const q = id ? supabase.from('applications').update(input).eq('id', id) : supabase.from('applications').insert(input);
  return unwrap(await q.select().single()) as Application;
}

export async function deleteApplication(id: string): Promise<void> {
  unwrap(await supabase.from('applications').delete().eq('id', id).select('id'));
}

export async function fetchResponses(): Promise<ResponseRow[]> {
  return unwrap(await supabase.from('responses').select('*').order('received_on', { ascending: false }).limit(1000)) as ResponseRow[];
}

const RESPONSE_EFFECT: Record<ResponseType, { app: AppStatus; stage: Stage | null }> = {
  rejection: { app: 'rejected', stage: 'rejected' },
  info_request: { app: 'sent', stage: null },
  interview: { app: 'interview', stage: 'interview' },
  offer: { app: 'offer', stage: 'offer' },
  no_reply: { app: 'no_reply', stage: null },
};

export type ResponseInput = Omit<ResponseRow, 'id'>;
/** Enregistre une réponse et met à jour la candidature et l'étape de la cible liées. */
export async function saveResponse(input: ResponseInput, id?: string): Promise<{ response: ResponseRow; target: Target | null }> {
  const q = id ? supabase.from('responses').update(input).eq('id', id) : supabase.from('responses').insert(input);
  const response = unwrap(await q.select().single()) as ResponseRow;
  const effect = RESPONSE_EFFECT[input.type];
  if (input.application_id && input.type !== 'info_request') {
    unwrap(await supabase.from('applications').update({ status: effect.app }).eq('id', input.application_id).select('id'));
  }
  let target: Target | null = null;
  if (input.target_id && effect.stage) {
    target = unwrap(await supabase.from('targets').update({ stage: effect.stage, last_contact_on: input.received_on }).eq('id', input.target_id).select().single()) as Target;
  }
  return { response, target };
}

export async function deleteResponse(id: string): Promise<void> {
  unwrap(await supabase.from('responses').delete().eq('id', id).select('id'));
}

/** Export Excel (.xlsx) : une ligne d'en-têtes puis les lignes affichées. */
export async function exportXlsx(sheet: string, headers: string[], rows: (string | number | Date | null)[][], fileName: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [headers.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...rows.map((r) => r.map((v) => (v === null || v === '' ? null : v)))];
  await writeXlsxFile(data, { sheet: sheet.slice(0, 31), stickyRowsCount: 1, dateFormat: 'dd/mm/yyyy', columns: headers.map((h) => ({ width: Math.max(12, Math.min(40, h.length + 6)) })) }).toFile(fileName);
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
  const { data, error } = await supabase.functions.invoke('cap-emploi-ai', { body });
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
  const [profile, targets, weeks, documents, usage, opportunities, digests, applications, responses, receivedOffers] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase.from('targets').select('*'),
    supabase.from('weeks').select('*'),
    supabase.from('documents').select('*'),
    supabase.from('ai_usage').select('*'),
    supabase.from('opportunities').select('*'),
    supabase.from('digests').select('*'),
    supabase.from('applications').select('*'),
    supabase.from('responses').select('*'),
    supabase.from('received_offers').select('*'),
  ]);
  const data = {
    exported_at: new Date().toISOString(), profile: unwrap(profile), targets: unwrap(targets), weeks: unwrap(weeks), documents: unwrap(documents),
    ai_usage: unwrap(usage), opportunities: unwrap(opportunities), digests: unwrap(digests),
    applications: unwrap(applications), responses: unwrap(responses), received_offers: unwrap(receivedOffers),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export async function deleteMyAccount(): Promise<void> {
  unwrap(await supabase.rpc('delete_my_account'));
  await supabase.auth.signOut();
}
