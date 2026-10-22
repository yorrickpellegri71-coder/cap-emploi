// Cap Emploi — fonction serveur IA (Supabase Edge Function, Deno).
// La clé Claude reste côté serveur. Actions :
//   extract     : lit un CV (texte ou PDF) et en extrait un profil structuré ;
//   brief       : fiche entreprise à partir d'une offre ou d'un nom (résumé, attentes, idée d'outil digital, points à vérifier) ;
//   tailor      : dossier complet (e-mail, lettre, CV, présentation) à partir d'une offre et du profil, sans inventer de faits ;
//   search_jobs : recherche d'offres au Luxembourg par l'API officielle de Jooble (si JOOBLE_API_KEY est défini) ;
//   discover    : « Opportunités pour moi » : offres et entreprises cibles probables, notées selon le profil ;
//   prepare     : prépare le dossier complet d'une opportunité et la place dans la file « À valider » ;
//   daily       : tâche planifiée (en-tête x-cron-secret) : opportunités du jour et résumé, e-mail facultatif.
// Rien n'est jamais envoyé à un employeur : l'envoi reste fait par l'utilisateur, après validation.
// Les secrets sont communs à tout le projet hôte : ceux de Cap Emploi sont préfixés CAP_ pour ne jamais se mélanger.
// Attendu : CAP_ANTHROPIC_API_KEY ; facultatifs : CAP_CLAUDE_MODEL, CAP_FREE_DOCS_PER_MONTH, CAP_ALLOWED_ORIGIN, CAP_JOOBLE_API_KEY,
// CAP_JOOBLE_HOST, CAP_SCHEMA, CAP_CRON_SECRET (tâche quotidienne), CAP_RESEND_API_KEY + CAP_DIGEST_FROM + CAP_APP_URL (e-mail du résumé).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.

import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

const MODEL = Deno.env.get('CAP_CLAUDE_MODEL') ?? 'claude-opus-5-5';
const FREE_DOCS = Number(Deno.env.get('CAP_FREE_DOCS_PER_MONTH') ?? 3);
const MAX_EXTRACTIONS = 20;
const MAX_BRIEFS = 30;
const MAX_SEARCHES = 200;
const MAX_OFFER_CHARS = 20000;
const MAX_CV_CHARS = 60000;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const LANG_NAMES: Record<string, string> = { fr: 'French', en: 'English', de: 'German' };

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('CAP_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Erreur renvoyée au navigateur avec un code stable, traduit côté interface. */
class Fail extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

const anthropic = new Anthropic({ apiKey: Deno.env.get('CAP_ANTHROPIC_API_KEY') });
// Schéma de Cap Emploi dans le projet hôte.
const SCHEMA = Deno.env.get('CAP_SCHEMA') ?? 'cap_emploi';
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, any, any>;

// ───────────────────────── Schémas de sortie ─────────────────────────

const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['full_name', 'headline', 'summary', 'location', 'experiences', 'education', 'skills', 'languages', 'certifications', 'cv_text'],
  properties: {
    full_name: { type: 'string' },
    headline: { type: 'string', description: 'Current or target job title, short' },
    summary: { type: 'string' },
    location: { type: 'string' },
    experiences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'location', 'start', 'end', 'achievements'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          achievements: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['degree', 'school', 'year'],
        properties: { degree: { type: 'string' }, school: { type: 'string' }, year: { type: 'string' } },
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    languages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'level'],
        properties: { language: { type: 'string' }, level: { type: 'string' } },
      },
    },
    certifications: { type: 'array', items: { type: 'string' } },
    cv_text: { type: 'string', description: 'Faithful plain-text transcription of the whole CV' },
  },
};

const TAILOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'job_title', 'email_subject', 'email_body', 'letter', 'cv', 'pitch', 'gaps'],
  properties: {
    company: { type: 'string' },
    job_title: { type: 'string' },
    email_subject: { type: 'string' },
    email_body: { type: 'string' },
    letter: { type: 'string' },
    cv: { type: 'string' },
    pitch: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
};

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'job_title', 'sector', 'location', 'contact_name', 'contact_role', 'summary', 'expectations', 'digital_idea', 'to_check'],
  properties: {
    company: { type: 'string' },
    job_title: { type: 'string' },
    sector: { type: 'string' },
    location: { type: 'string' },
    contact_name: { type: 'string' },
    contact_role: { type: 'string' },
    summary: { type: 'string' },
    expectations: { type: 'array', items: { type: 'string' } },
    digital_idea: { type: 'string' },
    to_check: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACT_SYSTEM = `You extract a candidate profile from a CV for a job-search assistant.
Copy facts exactly as written: names, dates, employers, figures, degrees, languages. Never infer, round, embellish or add anything that is not in the CV. If a field is absent, use an empty string or an empty list.
Keep the CV's own language for every field. Achievements are short bullet sentences taken from the CV, keeping every number it gives.
cv_text is a faithful plain-text transcription of the whole CV.`;

const BRIEF_SYSTEM = `You prepare a short company brief for a job seeker in Luxembourg and the Greater Region who wants to apply directly.
You have no web access. Separate what is known from what is assumed:
- company, job_title, location, contact_name, contact_role: only as written in the job offer or given by the user; otherwise an empty string. Never guess a person's name.
- sector: the most likely sector, short.
- summary: three or four sentences. Use the offer's own statements first. You may add widely known public facts about a well-known company, phrased cautiously; never invent figures, dates, owners, openings or events.
- expectations: four to six likely expectations of the employer for this role, derived from the offer and the role; mark nothing as certain that the offer does not say.
- digital_idea: one concrete, modest digital tool or quick win the candidate could propose in an interview (for example a dashboard, an automation, a guest-experience improvement), tied to the expectations, in two or three sentences.
- to_check: three to six points the candidate must verify before sending (decision-maker's name, recent news, exact requirements, languages, salary range, anything you assumed).
Write every text field in the requested output language.`;

const TAILOR_SYSTEM = `You write a complete, tailored application pack for one job offer, for a job-search assistant used in Luxembourg and the Greater Region.

The absolute rule: use only facts present in the candidate profile below. Never invent or alter an employer, title, date, figure, degree, certification, language level or skill. You may select, reorder, group and rephrase the candidate's facts to match the offer, and translate them faithfully into the output language. When the offer asks for something the profile does not show, do not claim it: list it in "gaps" instead, as a short sentence in the output language, so the candidate can decide what to add.

The CV: plain text with simple markdown (a "# " line for the name, "## " section headings, "- " bullets). One or two pages: headline matched to the offer, short profile summary, experience in reverse chronological order with the most relevant achievements first, skills, languages, education. No photo, no age, no marital status.
The letter: plain text, under 350 words, addressed to the contact if known, otherwise a neutral greeting in the output language. Three to four short paragraphs: why this company and role, two or three concrete proofs from the profile tied to the offer's needs, a clear request for a meeting. Polite closing customary in the output language. Do not invent the company's facts beyond what the offer says.
The email: email_subject is a short subject line naming the role; email_body is a brief covering email (under 120 words) that presents the attached CV and letter, with one concrete proof and a request for a meeting.
The pitch: a short global presentation of the candidate for this role (about 80 to 120 words), usable as a LinkedIn message or an oral introduction, first person.
If a company brief is given, use it only to understand the employer's likely needs; its content is unverified, so never state it as fact in the documents.
Write all documents entirely in the requested output language. "company" and "job_title" are taken from the offer (empty string if absent).`;

// ───────────────────────── Utilitaires ─────────────────────────

const monthKey = () => new Date().toISOString().slice(0, 7);

async function usageRow(admin: Db, userId: string) {
  const { data, error } = await admin.from('ai_usage').select('*').eq('user_id', userId).eq('month', monthKey()).maybeSingle();
  if (error) throw error;
  return data ?? { documents: 0, extractions: 0, briefs: 0, searches: 0, discoveries: 0, input_tokens: 0, output_tokens: 0 };
}

type UsageField = 'documents' | 'extractions' | 'briefs' | 'searches' | 'discoveries';

async function recordUsage(admin: Db, userId: string, field: UsageField, usage?: Anthropic.Beta.BetaUsage) {
  const row = await usageRow(admin, userId);
  const { error } = await admin.from('ai_usage').upsert({
    user_id: userId,
    month: monthKey(),
    documents: row.documents + (field === 'documents' ? 1 : 0),
    extractions: row.extractions + (field === 'extractions' ? 1 : 0),
    briefs: (row.briefs ?? 0) + (field === 'briefs' ? 1 : 0),
    searches: (row.searches ?? 0) + (field === 'searches' ? 1 : 0),
    discoveries: (row.discoveries ?? 0) + (field === 'discoveries' ? 1 : 0),
    input_tokens: Number(row.input_tokens) + (usage?.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens) + (usage?.output_tokens ?? 0),
  });
  if (error) throw error;
}

/** Appel Claude avec sortie JSON contrainte par schéma. */
async function callClaude(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>) {
  const message = await anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  }).finalMessage();
  if (message.stop_reason === 'refusal') throw new Fail('ai_refused', 422);
  if (message.stop_reason === 'max_tokens') throw new Fail('ai_too_long', 422);
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return { result: JSON.parse(text) as Record<string, unknown>, usage: message.usage };
}

// ───────────────────────── Actions ─────────────────────────

async function extract(body: Record<string, unknown>, userId: string, admin: Db) {
  const row = await usageRow(admin, userId);
  if (row.extractions >= MAX_EXTRACTIONS) throw new Fail('quota_extract', 429);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (typeof body.pdf_base64 === 'string' && body.pdf_base64) {
    if (body.pdf_base64.length > (MAX_PDF_BYTES * 4) / 3) throw new Fail('file_too_large', 413);
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdf_base64 } });
    content.push({ type: 'text', text: 'Extract the candidate profile from this CV.' });
  } else if (typeof body.cv_text === 'string' && body.cv_text.trim()) {
    content.push({ type: 'text', text: `Extract the candidate profile from this CV.\n\n<cv>\n${body.cv_text.slice(0, MAX_CV_CHARS)}\n</cv>` });
  } else {
    throw new Fail('cv_missing');
  }

  const { result, usage } = await callClaude(EXTRACT_SYSTEM, content, PROFILE_SCHEMA);
  await recordUsage(admin, userId, 'extractions', usage);
  return { profile: result };
}

// Les fonctions métier reçoivent un client et l'identifiant de l'utilisateur, et filtrent toujours par utilisateur :
// elles servent aussi bien au client de l'utilisateur (RLS) qu'au client de service de la tâche quotidienne.
async function tailor(body: Record<string, unknown>, userId: string, db: Db, admin: Db) {
  const offer = typeof body.offer_text === 'string' ? body.offer_text.trim() : '';
  if (offer.length < 80) throw new Fail('offer_too_short');
  const lang = typeof body.lang === 'string' && body.lang in LANG_NAMES ? body.lang : 'fr';

  const { data: profile, error } = await db.from('profiles').select('display_name, plan, cv_text, profile_data').eq('id', userId).single();
  if (error) throw error;
  const facts = profile.profile_data && Object.keys(profile.profile_data).length ? JSON.stringify(profile.profile_data, null, 1) : '';
  if (!facts && !profile.cv_text.trim()) throw new Fail('profile_empty');

  const row = await usageRow(admin, userId);
  if (profile.plan === 'free' && row.documents >= FREE_DOCS) throw new Fail('quota_documents', 402);

  let target: { company: string; contact_name: string; contact_role: string; brief: Record<string, unknown> } | null = null;
  if (typeof body.target_id === 'string' && body.target_id) {
    const res = await db.from('targets').select('company, contact_name, contact_role, brief').eq('id', body.target_id).eq('user_id', userId).maybeSingle();
    target = res.data;
  }
  const brief = target?.brief && Object.keys(target.brief).length
    ? `<company_brief_unverified>\n${JSON.stringify({ summary: target.brief.summary, expectations: target.brief.expectations }, null, 1)}\n</company_brief_unverified>`
    : '';

  const context = [
    `<candidate_profile>\n${facts || '(no structured profile)'}\n</candidate_profile>`,
    profile.cv_text.trim() ? `<original_cv>\n${profile.cv_text.slice(0, MAX_CV_CHARS)}\n</original_cv>` : '',
    target ? `<target>\nCompany: ${target.company}\nContact: ${target.contact_name}${target.contact_role ? `, ${target.contact_role}` : ''}\n</target>` : '',
    brief,
    `<job_offer>\n${offer.slice(0, MAX_OFFER_CHARS)}\n</job_offer>`,
    `Output language: ${LANG_NAMES[lang]}.`,
  ].filter(Boolean).join('\n\n');

  const { result, usage } = await callClaude(TAILOR_SYSTEM, [{ type: 'text', text: context }], TAILOR_SCHEMA);
  await recordUsage(admin, userId, 'documents', usage);

  const { data: doc, error: insErr } = await db.from('documents').insert({
    user_id: userId,
    target_id: typeof body.target_id === 'string' && body.target_id ? body.target_id : null,
    company: String(result.company || target?.company || '').slice(0, 200),
    job_title: String(result.job_title ?? '').slice(0, 200),
    lang,
    offer_text: offer.slice(0, MAX_OFFER_CHARS),
    cv: String(result.cv ?? ''),
    letter: String(result.letter ?? ''),
    email_subject: String(result.email_subject ?? '').slice(0, 300),
    email_body: String(result.email_body ?? ''),
    pitch: String(result.pitch ?? ''),
    gaps: Array.isArray(result.gaps) ? result.gaps : [],
  }).select().single();
  if (insErr) throw insErr;
  return { document: doc, remaining: profile.plan === 'free' ? Math.max(FREE_DOCS - row.documents - 1, 0) : null };
}

async function companyBrief(body: Record<string, unknown>, userId: string, admin: Db) {
  const company = typeof body.company === 'string' ? body.company.trim().slice(0, 200) : '';
  const offer = typeof body.offer_text === 'string' ? body.offer_text.trim().slice(0, MAX_OFFER_CHARS) : '';
  if (!company && offer.length < 80) throw new Fail('brief_missing');
  const lang = typeof body.lang === 'string' && body.lang in LANG_NAMES ? body.lang : 'fr';
  const row = await usageRow(admin, userId);
  if ((row.briefs ?? 0) >= MAX_BRIEFS) throw new Fail('quota_briefs', 429);

  const text = [
    company ? `Company name given by the user: ${company}` : '',
    typeof body.job_url === 'string' && body.job_url ? `Job ad link: ${body.job_url.slice(0, 500)}` : '',
    offer ? `<job_offer>\n${offer}\n</job_offer>` : 'No job offer text: this is a spontaneous application.',
    `Output language: ${LANG_NAMES[lang]}.`,
  ].filter(Boolean).join('\n\n');
  const { result, usage } = await callClaude(BRIEF_SYSTEM, [{ type: 'text', text }], BRIEF_SCHEMA);
  if (company) result.company = company;
  await recordUsage(admin, userId, 'briefs', usage);
  return { brief: result };
}

/** Recherche d'offres par l'API officielle de Jooble (agrégateur qui autorise cet usage avec une clé). */
async function searchJobs(body: Record<string, unknown>, userId: string, admin: Db) {
  const key = Deno.env.get('CAP_JOOBLE_API_KEY');
  if (!key) throw new Fail('search_disabled', 501);
  const keywords = typeof body.keywords === 'string' ? body.keywords.trim().slice(0, 200) : '';
  if (!keywords) throw new Fail('keywords_missing');
  const location = typeof body.location === 'string' && body.location.trim() ? body.location.trim().slice(0, 100) : 'Luxembourg';
  const page = Number.isInteger(body.page) ? Math.min(Math.max(Number(body.page), 1), 10) : 1;
  const row = await usageRow(admin, userId);
  if ((row.searches ?? 0) >= MAX_SEARCHES) throw new Fail('quota_searches', 429);

  const result = await jooble(key, keywords, location, page);
  await recordUsage(admin, userId, 'searches');
  return result;
}

type Job = { title: string; company: string; location: string; snippet: string; source: string; link: string; updated: string; salary: string };

async function jooble(key: string, keywords: string, location: string, page = 1): Promise<{ total: number; jobs: Job[] }> {
  const res = await fetch(`https://${Deno.env.get('CAP_JOOBLE_HOST') ?? 'jooble.org'}/api/${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, location, page: String(page) }),
  });
  if (!res.ok) {
    console.error('Jooble', res.status, await res.text().catch(() => ''));
    throw new Fail('search_unavailable', 502);
  }
  const data = await res.json() as { totalCount?: number; jobs?: Record<string, unknown>[] };
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/<[^>]+>/g, '').trim() : '');
  return {
    total: data.totalCount ?? 0,
    jobs: (data.jobs ?? []).slice(0, 30).map((j) => ({
      title: str(j.title), company: str(j.company), location: str(j.location), snippet: str(j.snippet),
      source: str(j.source), link: str(j.link), updated: str(j.updated), salary: str(j.salary),
    })),
  };
}

// ───────────────────────── Opportunités pour moi ─────────────────────────

const MAX_DISCOVERIES = 40;
const DISCOVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['jobs', 'companies'],
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'score', 'sector', 'reason'],
        properties: { index: { type: 'integer' }, score: { type: 'integer' }, sector: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'location', 'sector', 'score', 'reason'],
        properties: { company: { type: 'string' }, location: { type: 'string' }, sector: { type: 'string' }, score: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
  },
};

const DISCOVER_SYSTEM = `You match a job seeker's profile with opportunities in Luxembourg and the Greater Region.
1. jobs: score every listed job ad from 0 to 100 for fit with the candidate's experience, level, sector and languages, using only the profile's facts and the ad excerpt. Give the sector and one short reason (max 25 words) naming the concrete match or the main gap. Return one item per ad, with its index.
2. companies: propose up to 8 real employers in Luxembourg or the Greater Region that are likely to hire this profile through a direct, spontaneous approach. Only well-known, existing organisations you are confident about; never invent a company. Exclude the companies listed as already known. Score the likely fit from 0 to 100 and give one short reason (max 25 words) tied to the profile. Location: city if you are confident, otherwise "Luxembourg".
Be strict: 80+ only for a strong, evident match. Write reasons and sectors in the requested output language.`;

type Profile = {
  display_name: string; ui_lang: string; doc_lang: string; trade: string; plan: string; cv_text: string;
  profile_data: Record<string, unknown>; opp_auto_prepare: boolean; opp_min_score: number;
};
type Opportunity = { id: string; kind: string; title: string; company: string; location: string; sector: string; link: string; snippet: string; score: number; reason: string; status: string; target_id: string | null };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function loadProfile(db: Db, userId: string): Promise<Profile> {
  const { data, error } = await db.from('profiles')
    .select('display_name, ui_lang, doc_lang, trade, plan, cv_text, profile_data, opp_auto_prepare, opp_min_score').eq('id', userId).single();
  if (error) throw error;
  return data as Profile;
}

/** Requêtes de recherche tirées du profil : titre visé et dernier poste. */
function profileQueries(p: Profile): string[] {
  const d = p.profile_data as { headline?: string; experiences?: { title?: string }[] };
  const list = [d.headline, d.experiences?.[0]?.title].map((x) => (x ?? '').trim()).filter(Boolean);
  return [...new Set(list.map((x) => x.slice(0, 80)))].slice(0, 2);
}

async function discoverFor(db: Db, admin: Db, userId: string) {
  const profile = await loadProfile(db, userId);
  const facts = Object.keys(profile.profile_data ?? {}).length ? JSON.stringify(profile.profile_data, null, 1) : profile.cv_text.slice(0, MAX_CV_CHARS);
  if (!facts.trim()) throw new Fail('profile_empty');
  const usage = await usageRow(admin, userId);
  if ((usage.discoveries ?? 0) >= MAX_DISCOVERIES) throw new Fail('quota_discoveries', 429);

  const [{ data: known }, { data: targets }] = await Promise.all([
    db.from('opportunities').select('dedupe_key').eq('user_id', userId),
    db.from('targets').select('company').eq('user_id', userId),
  ]);
  const seen = new Set((known ?? []).map((k: { dedupe_key: string }) => k.dedupe_key));
  const knownCompanies = [...new Set((targets ?? []).map((t: { company: string }) => t.company))];

  // 1. Offres collectées par l'API officielle de Jooble, nouvelles uniquement.
  const key = Deno.env.get('CAP_JOOBLE_API_KEY');
  let jobs: Job[] = [];
  if (key) {
    for (const q of profileQueries(profile)) {
      try { jobs.push(...(await jooble(key, q, 'Luxembourg')).jobs); } catch { /* une source en panne ne bloque pas les entreprises */ }
    }
    const fresh = new Map<string, Job>();
    for (const j of jobs) {
      const k = `job:${j.link || norm(`${j.title} ${j.company}`)}`;
      if (!seen.has(k) && !fresh.has(k)) fresh.set(k, j);
    }
    jobs = [...fresh.values()].slice(0, 30);
  }

  // 2. Notation des offres et entreprises probables, en un seul appel.
  const text = [
    `<candidate_profile>\n${facts}\n</candidate_profile>`,
    `Field: ${profile.trade}.`,
    `Companies already known (exclude): ${knownCompanies.join(', ') || 'none'}.`,
    jobs.length ? `<job_ads>\n${jobs.map((j, i) => `[${i}] ${j.title} | ${j.company} | ${j.location}\n${j.snippet.slice(0, 600)}`).join('\n\n')}\n</job_ads>` : 'No job ads collected today: return an empty jobs list.',
    `Output language: ${LANG_NAMES[profile.ui_lang] ?? 'French'}.`,
  ].join('\n\n');
  const { result, usage: tokens } = await callClaude(DISCOVER_SYSTEM, [{ type: 'text', text }], DISCOVER_SCHEMA);
  await recordUsage(admin, userId, 'discoveries', tokens);

  const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const rows: Record<string, unknown>[] = [];
  for (const m of (result.jobs as { index: number; score: number; sector: string; reason: string }[]) ?? []) {
    const j = jobs[m.index];
    if (!j) continue;
    rows.push({
      user_id: userId, kind: 'job', title: j.title.slice(0, 200), company: j.company.slice(0, 200), location: j.location.slice(0, 120),
      sector: String(m.sector).slice(0, 120), source: j.source.slice(0, 120), link: j.link.slice(0, 1000), snippet: j.snippet.slice(0, 2000),
      score: clamp(m.score), reason: String(m.reason).slice(0, 400), dedupe_key: `job:${j.link || norm(`${j.title} ${j.company}`)}`,
    });
  }
  const knownNorm = new Set(knownCompanies.map(norm));
  for (const c of (result.companies as { company: string; location: string; sector: string; score: number; reason: string }[]) ?? []) {
    const k = `company:${norm(c.company)}`;
    if (!c.company.trim() || seen.has(k) || knownNorm.has(norm(c.company))) continue;
    rows.push({
      user_id: userId, kind: 'company', title: '', company: c.company.slice(0, 200), location: String(c.location).slice(0, 120),
      sector: String(c.sector).slice(0, 120), score: clamp(c.score), reason: String(c.reason).slice(0, 400), dedupe_key: k,
    });
  }
  let inserted: Opportunity[] = [];
  if (rows.length) {
    const { data, error } = await db.from('opportunities').upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select();
    if (error) throw error;
    inserted = (data ?? []) as Opportunity[];
  }
  await admin.from('profiles').update({ opp_last_run: new Date().toISOString() }).eq('id', userId);

  // 3. Opportunités à préparer automatiquement : au-dessus du seuil, dans la limite du quota.
  const docsLeft = profile.plan === 'free' ? Math.max(FREE_DOCS - usage.documents, 0) : 5;
  const toPrepare = profile.opp_auto_prepare
    ? inserted.filter((o) => o.score >= profile.opp_min_score).sort((a, b) => b.score - a.score).slice(0, docsLeft).map((o) => o.id)
    : [];
  return { inserted, toPrepare, profile, jobsEnabled: Boolean(key) };
}

/** Prépare le dossier d'une opportunité : cible créée ou retrouvée, dossier complet, passage en « À valider ». */
async function prepareOpportunity(db: Db, admin: Db, userId: string, oppId: string, langOverride?: string) {
  const { data: opp, error } = await db.from('opportunities').select('*').eq('id', oppId).eq('user_id', userId).single();
  if (error) throw error;
  const o = opp as Opportunity;
  if (!['new', 'preparing'].includes(o.status) && !langOverride) return { opportunity: o };
  const profile = await loadProfile(db, userId);
  await db.from('opportunities').update({ status: 'preparing' }).eq('id', o.id).eq('user_id', userId);

  try {
    // Cible : celle du même nom si elle existe, sinon une nouvelle « À contacter ».
    let targetId = o.target_id;
    if (!targetId) {
      const { data: existing } = await db.from('targets').select('id, company').eq('user_id', userId);
      const match = (existing ?? []).find((t: { company: string }) => norm(t.company) === norm(o.company));
      if (match) targetId = match.id;
      else {
        const { data: created, error: tErr } = await db.from('targets').insert({
          user_id: userId, company: o.company || o.title, sector: o.sector, priority: o.score >= 80 ? 'A' : 'B',
          channel: o.kind === 'job' ? 'jobboard' : 'email', job_url: o.link, notes: o.reason,
          brief: { company: o.company, job_title: o.title, sector: o.sector, location: o.location, offer_text: o.kind === 'job' ? o.snippet : '' },
        }).select('id').single();
        if (tErr) throw tErr;
        targetId = created.id;
      }
    }
    const headline = String((profile.profile_data as { headline?: string }).headline ?? '');
    const offer = o.kind === 'job'
      ? `${o.title}\n${[o.company, o.location].filter(Boolean).join(' – ')}\n${o.snippet}\n(Excerpt of the job ad: rely on it only for the employer's needs.)`
      : `Spontaneous application, no job ad. Company: ${o.company}${o.location ? `, ${o.location}` : ''}. Sector: ${o.sector}.\nTarget role: ${headline || 'to be inferred from the profile'}.\nWhy this company fits (unverified): ${o.reason}`;
    const { document } = await tailor({ offer_text: offer.padEnd(80, ' '), lang: langOverride ?? profile.doc_lang, target_id: targetId }, userId, db, admin);
    const { data: updated } = await db.from('opportunities')
      .update({ status: 'to_validate', target_id: targetId, document_id: document.id }).eq('id', o.id).eq('user_id', userId).select().single();
    return { opportunity: updated, document };
  } catch (e) {
    await db.from('opportunities').update({ status: 'new' }).eq('id', o.id).eq('user_id', userId);
    throw e;
  }
}

async function recordDigest(admin: Db, userId: string, inserted: Opportunity[], prepared: number) {
  const day = new Date().toISOString().slice(0, 10);
  const { data: prev } = await admin.from('digests').select('*').eq('user_id', userId).eq('day', day).maybeSingle();
  const top = [...inserted].sort((a, b) => b.score - a.score).slice(0, 5)
    .map((o) => ({ id: o.id, kind: o.kind, title: o.title, company: o.company, score: o.score, reason: o.reason }));
  await admin.from('digests').upsert({
    user_id: userId, day,
    new_jobs: (prev?.new_jobs ?? 0) + inserted.filter((o) => o.kind === 'job').length,
    new_companies: (prev?.new_companies ?? 0) + inserted.filter((o) => o.kind === 'company').length,
    prepared: (prev?.prepared ?? 0) + prepared,
    top: [...top, ...((prev?.top as unknown[]) ?? [])].slice(0, 5),
  }, { onConflict: 'user_id,day' });
}

const DIGEST_TEXT: Record<string, { subject: string; intro: (j: number, c: number, p: number) => string; cta: string; note: string }> = {
  fr: { subject: 'Cap Emploi : vos opportunités du jour', intro: (j, c, p) => `${j} nouvelle(s) offre(s) et ${c} entreprise(s) cible(s) pour vous. ${p} dossier(s) prêt(s) à valider.`, cta: 'Ouvrir mes opportunités', note: 'Rien n’est envoyé sans votre validation.' },
  en: { subject: 'Cap Emploi: your opportunities today', intro: (j, c, p) => `${j} new job ad(s) and ${c} target compan(ies) for you. ${p} pack(s) ready to approve.`, cta: 'Open my opportunities', note: 'Nothing is sent without your approval.' },
  de: { subject: 'Cap Emploi: Ihre Chancen von heute', intro: (j, c, p) => `${j} neue Anzeige(n) und ${c} Zielunternehmen für Sie. ${p} Unterlage(n) zur Freigabe bereit.`, cta: 'Meine Chancen öffnen', note: 'Nichts wird ohne Ihre Freigabe gesendet.' },
};
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** E-mail du résumé quotidien, seulement si RESEND_API_KEY est défini et que l'utilisateur l'a demandé. */
async function emailDigest(admin: Db, userId: string, lang: string, inserted: Opportunity[], prepared: number) {
  const key = Deno.env.get('CAP_RESEND_API_KEY');
  const from = Deno.env.get('CAP_DIGEST_FROM');
  if (!key || !from || !inserted.length) return false;
  const { data } = await admin.auth.admin.getUserById(userId);
  const to = data.user?.email;
  if (!to) return false;
  const t = DIGEST_TEXT[lang] ?? DIGEST_TEXT.fr;
  const url = `${Deno.env.get('CAP_APP_URL') ?? ''}/opportunites`;
  const items = [...inserted].sort((a, b) => b.score - a.score).slice(0, 5)
    .map((o) => `<li><strong>${o.score}</strong> · ${escHtml(o.title ? `${o.title} – ${o.company}` : o.company)}<br><small>${escHtml(o.reason)}</small></li>`).join('');
  const html = `<p>${escHtml(t.intro(inserted.filter((o) => o.kind === 'job').length, inserted.filter((o) => o.kind === 'company').length, prepared))}</p><ul>${items}</ul><p><a href="${escHtml(url)}">${t.cta}</a></p><p><small>${t.note}</small></p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: t.subject, html }),
  });
  if (!res.ok) console.error('Resend', res.status, await res.text().catch(() => ''));
  return res.ok;
}

/** Tâche quotidienne : traite un utilisateur à la fois et s'arrête avant la limite de durée ; relancée toutes les 10 minutes le matin. */
async function daily(admin: Db) {
  const started = Date.now();
  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data: users, error } = await admin.from('profiles').select('id, ui_lang, opp_daily_email')
    .eq('onboarded', true).or(`opp_last_run.is.null,opp_last_run.lt.${since}`).limit(20);
  if (error) throw error;
  const done: string[] = [];
  for (const u of users ?? []) {
    if (Date.now() - started > 60_000) break;
    try {
      const { inserted, toPrepare } = await discoverFor(admin, admin, u.id);
      let prepared = 0;
      for (const id of toPrepare.slice(0, 1)) {
        if (Date.now() - started > 80_000) break;
        try { await prepareOpportunity(admin, admin, u.id, id); prepared++; } catch (e) { console.error('prepare', u.id, e); }
      }
      await recordDigest(admin, u.id, inserted, prepared);
      if (u.opp_daily_email) {
        const sent = await emailDigest(admin, u.id, u.ui_lang, inserted, prepared);
        if (sent) await admin.from('digests').update({ emailed: true }).eq('user_id', u.id).eq('day', new Date().toISOString().slice(0, 10));
      }
      done.push(u.id);
    } catch (e) {
      console.error('daily', u.id, e);
      // Profil vide ou quota atteint : on ne réessaie pas avant demain.
      await admin.from('profiles').update({ opp_last_run: new Date().toISOString() }).eq('id', u.id);
    }
  }
  return { processed: done.length };
}

// ───────────────────────── Point d'entrée ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    // Tâche planifiée : authentifiée par un secret partagé, sans session utilisateur.
    const cronSecret = Deno.env.get('CAP_CRON_SECRET');
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      return json(await daily(createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: SCHEMA } })));
    }
    // Client au nom de l'utilisateur : la sécurité par ligne (RLS) s'applique.
    const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { db: { schema: SCHEMA }, global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (!user) throw new Fail('unauthorized', 401);
    // Client de service : uniquement pour le compteur de consommation.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: SCHEMA } });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === 'extract') return json(await extract(body, user.id, admin));
    if (body.action === 'tailor') return json(await tailor(body, user.id, db, admin));
    if (body.action === 'brief') return json(await companyBrief(body, user.id, admin));
    if (body.action === 'search_jobs') return json(await searchJobs(body, user.id, admin));
    if (body.action === 'discover') {
      const { inserted, toPrepare, jobsEnabled } = await discoverFor(db, admin, user.id);
      await recordDigest(admin, user.id, inserted, 0);
      return json({ inserted: inserted.length, toPrepare, jobsEnabled });
    }
    if (body.action === 'prepare' && typeof body.opportunity_id === 'string') {
      const lang = typeof body.lang === 'string' && body.lang in LANG_NAMES ? body.lang : undefined;
      return json(await prepareOpportunity(db, admin, user.id, body.opportunity_id, lang));
    }
    throw new Fail('unknown_action');
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'ai_busy' }, 503);
    if (e instanceof Anthropic.APIError) {
      console.error('Claude', e.status, e.message);
      return json({ error: 'ai_unavailable' }, 502);
    }
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
