// Cap Emploi — fonction serveur IA (Supabase Edge Function, Deno).
// La clé Claude reste côté serveur. Deux actions :
//   extract : lit un CV (texte ou PDF) et en extrait un profil structuré ;
//   tailor  : à partir d'une offre et du profil, rédige un CV et une lettre sur mesure, sans inventer de faits.
// Secrets attendus : ANTHROPIC_API_KEY ; facultatif : CLAUDE_MODEL, FREE_DOCS_PER_MONTH, ALLOWED_ORIGIN.
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.

import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5';
const FREE_DOCS = Number(Deno.env.get('FREE_DOCS_PER_MONTH') ?? 3);
const MAX_EXTRACTIONS = 20;
const MAX_OFFER_CHARS = 20000;
const MAX_CV_CHARS = 60000;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const LANG_NAMES: Record<string, string> = { fr: 'French', en: 'English', de: 'German' };

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Erreur renvoyée au navigateur avec un code stable, traduit côté interface. */
class Fail extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

const anthropic = new Anthropic();

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
  required: ['company', 'job_title', 'cv', 'letter', 'gaps'],
  properties: {
    company: { type: 'string' },
    job_title: { type: 'string' },
    cv: { type: 'string' },
    letter: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACT_SYSTEM = `You extract a candidate profile from a CV for a job-search assistant.
Copy facts exactly as written: names, dates, employers, figures, degrees, languages. Never infer, round, embellish or add anything that is not in the CV. If a field is absent, use an empty string or an empty list.
Keep the CV's own language for every field. Achievements are short bullet sentences taken from the CV, keeping every number it gives.
cv_text is a faithful plain-text transcription of the whole CV.`;

const TAILOR_SYSTEM = `You write a tailored CV and cover letter for one job offer, for a job-search assistant used in Luxembourg and the Greater Region.

The absolute rule: use only facts present in the candidate profile below. Never invent or alter an employer, title, date, figure, degree, certification, language level or skill. You may select, reorder, group and rephrase the candidate's facts to match the offer, and translate them faithfully into the output language. When the offer asks for something the profile does not show, do not claim it: list it in "gaps" instead, as a short sentence in the output language, so the candidate can decide what to add.

The CV: plain text with simple markdown (a "# " line for the name, "## " section headings, "- " bullets). One or two pages: headline matched to the offer, short profile summary, experience in reverse chronological order with the most relevant achievements first, skills, languages, education. No photo, no age, no marital status.
The letter: plain text, under 350 words, addressed to the contact if known, otherwise a neutral greeting in the output language. Three to four short paragraphs: why this company and role, two or three concrete proofs from the profile tied to the offer's needs, a clear request for a meeting. Polite closing customary in the output language. Do not invent the company's facts beyond what the offer says.
Write both documents entirely in the requested output language. "company" and "job_title" are taken from the offer (empty string if absent).`;

// ───────────────────────── Utilitaires ─────────────────────────

const monthKey = () => new Date().toISOString().slice(0, 7);

async function usageRow(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from('ai_usage').select('*').eq('user_id', userId).eq('month', monthKey()).maybeSingle();
  if (error) throw error;
  return data ?? { documents: 0, extractions: 0, input_tokens: 0, output_tokens: 0 };
}

async function recordUsage(admin: SupabaseClient, userId: string, field: 'documents' | 'extractions', usage: Anthropic.Beta.BetaUsage) {
  const row = await usageRow(admin, userId);
  const { error } = await admin.from('ai_usage').upsert({
    user_id: userId,
    month: monthKey(),
    documents: row.documents + (field === 'documents' ? 1 : 0),
    extractions: row.extractions + (field === 'extractions' ? 1 : 0),
    input_tokens: Number(row.input_tokens) + usage.input_tokens,
    output_tokens: Number(row.output_tokens) + usage.output_tokens,
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

async function extract(body: Record<string, unknown>, userId: string, admin: SupabaseClient) {
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

async function tailor(body: Record<string, unknown>, userId: string, db: SupabaseClient, admin: SupabaseClient) {
  const offer = typeof body.offer_text === 'string' ? body.offer_text.trim() : '';
  if (offer.length < 80) throw new Fail('offer_too_short');
  const lang = typeof body.lang === 'string' && body.lang in LANG_NAMES ? body.lang : 'fr';

  const { data: profile, error } = await db.from('profiles').select('display_name, plan, cv_text, profile_data').eq('id', userId).single();
  if (error) throw error;
  const facts = profile.profile_data && Object.keys(profile.profile_data).length ? JSON.stringify(profile.profile_data, null, 1) : '';
  if (!facts && !profile.cv_text.trim()) throw new Fail('profile_empty');

  const row = await usageRow(admin, userId);
  if (profile.plan === 'free' && row.documents >= FREE_DOCS) throw new Fail('quota_documents', 402);

  let target: { company: string; contact_name: string; contact_role: string } | null = null;
  if (typeof body.target_id === 'string' && body.target_id) {
    const res = await db.from('targets').select('company, contact_name, contact_role').eq('id', body.target_id).maybeSingle();
    target = res.data;
  }

  const context = [
    `<candidate_profile>\n${facts || '(no structured profile)'}\n</candidate_profile>`,
    profile.cv_text.trim() ? `<original_cv>\n${profile.cv_text.slice(0, MAX_CV_CHARS)}\n</original_cv>` : '',
    target ? `<target>\nCompany: ${target.company}\nContact: ${target.contact_name}${target.contact_role ? `, ${target.contact_role}` : ''}\n</target>` : '',
    `<job_offer>\n${offer.slice(0, MAX_OFFER_CHARS)}\n</job_offer>`,
    `Output language: ${LANG_NAMES[lang]}.`,
  ].filter(Boolean).join('\n\n');

  const { result, usage } = await callClaude(TAILOR_SYSTEM, [{ type: 'text', text: context }], TAILOR_SCHEMA);
  await recordUsage(admin, userId, 'documents', usage);

  const { data: doc, error: insErr } = await db.from('documents').insert({
    target_id: typeof body.target_id === 'string' && body.target_id ? body.target_id : null,
    company: String(result.company || target?.company || '').slice(0, 200),
    job_title: String(result.job_title ?? '').slice(0, 200),
    lang,
    offer_text: offer.slice(0, MAX_OFFER_CHARS),
    cv: String(result.cv ?? ''),
    letter: String(result.letter ?? ''),
    gaps: Array.isArray(result.gaps) ? result.gaps : [],
  }).select().single();
  if (insErr) throw insErr;
  return { document: doc, remaining: profile.plan === 'free' ? Math.max(FREE_DOCS - row.documents - 1, 0) : null };
}

// ───────────────────────── Point d'entrée ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    // Client au nom de l'utilisateur : la sécurité par ligne (RLS) s'applique.
    const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (!user) throw new Fail('unauthorized', 401);
    // Client de service : uniquement pour le compteur de consommation.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === 'extract') return json(await extract(body, user.id, admin));
    if (body.action === 'tailor') return json(await tailor(body, user.id, db, admin));
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
