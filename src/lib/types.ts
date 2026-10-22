export type Lang = 'fr' | 'en' | 'de';
export const LANGS: Lang[] = ['fr', 'en', 'de'];

export const COUNTERS = ['contacts', 'applications', 'followups', 'posts', 'training', 'network'] as const;
export type CounterKey = (typeof COUNTERS)[number];
export type Counters = Partial<Record<CounterKey, number>>;

export const STAGES = ['todo', 'contacted', 'followed_up', 'interview', 'offer', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];

export const CHANNELS = ['linkedin', 'email', 'phone', 'visit', 'jobboard', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TRADES = ['general', 'hospitality', 'events'] as const;
export type Trade = (typeof TRADES)[number];

export interface Experience { title: string; company: string; location: string; start: string; end: string; achievements: string[] }
export interface ProfileData {
  full_name?: string;
  headline?: string;
  summary?: string;
  location?: string;
  experiences?: Experience[];
  education?: { degree: string; school: string; year: string }[];
  skills?: string[];
  languages?: { language: string; level: string }[];
  certifications?: string[];
}

export interface Profile {
  id: string;
  display_name: string;
  ui_lang: Lang;
  doc_lang: Lang;
  trade: string;
  goals: Counters;
  followup_days: number;
  cv_text: string;
  profile_data: ProfileData;
  onboarded: boolean;
  consent_at: string | null;
  plan: 'free' | 'premium';
  opp_auto_prepare: boolean;
  opp_min_score: number;
  opp_daily_email: boolean;
}

export interface CompanyBrief {
  company?: string;
  job_title?: string;
  sector?: string;
  location?: string;
  contact_name?: string;
  contact_role?: string;
  summary?: string;
  expectations?: string[];
  digital_idea?: string;
  to_check?: string[];
  offer_text?: string;
  created_at?: string;
}

export interface Target {
  id: string;
  company: string;
  sector: string;
  priority: 'A' | 'B' | 'C';
  contact_name: string;
  contact_role: string;
  channel: Channel;
  stage: Stage;
  last_contact_on: string | null;
  job_url: string;
  notes: string;
  brief: CompanyBrief;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  target_id: string | null;
  company: string;
  job_title: string;
  lang: Lang;
  offer_text: string;
  cv: string;
  letter: string;
  email_subject: string;
  email_body: string;
  pitch: string;
  gaps: string[];
  created_at: string;
}

export interface JobResult { title: string; company: string; location: string; snippet: string; source: string; link: string; updated: string; salary: string }

export type OppStatus = 'new' | 'preparing' | 'to_validate' | 'validated' | 'sent' | 'dismissed';
export interface Opportunity {
  id: string;
  kind: 'job' | 'company';
  title: string;
  company: string;
  location: string;
  sector: string;
  source: string;
  link: string;
  snippet: string;
  score: number;
  reason: string;
  status: OppStatus;
  target_id: string | null;
  document_id: string | null;
  found_at: string;
  updated_at: string;
}
export interface Digest { day: string; new_jobs: number; new_companies: number; prepared: number; top: { id: string; kind: string; title: string; company: string; score: number; reason: string }[] }

export const APP_STATUSES = ['sent', 'followed_up', 'interview', 'offer', 'rejected', 'no_reply', 'withdrawn'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];
export const PIECES = ['email', 'letter', 'cv', 'pitch'] as const;
export interface Application {
  id: string;
  target_id: string | null;
  document_id: string | null;
  opportunity_id: string | null;
  applied_on: string;
  company: string;
  job_title: string;
  source: string;
  lang: Lang;
  documents: string[];
  status: AppStatus;
  followup_on: string | null;
  notes: string;
}
export const RESPONSE_TYPES = ['rejection', 'info_request', 'interview', 'offer', 'no_reply'] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];
export interface ResponseRow {
  id: string;
  application_id: string | null;
  target_id: string | null;
  received_on: string;
  company: string;
  job_title: string;
  type: ResponseType;
  next_step: string;
  next_step_on: string | null;
  notes: string;
}

export const OFFER_ORIGINS = ['gmail', 'outlook', 'collected', 'manual'] as const;
export type OfferOrigin = (typeof OFFER_ORIGINS)[number];
export type OfferStatus = 'new' | 'analyzed' | 'preparing' | 'ready' | 'sent' | 'dismissed';
export const OFFER_CHECKS = ['offer_read', 'conditions_ok', 'docs_reviewed'] as const;
export type OfferCheck = (typeof OFFER_CHECKS)[number];
export interface OfferAnalysis {
  job_title?: string;
  company?: string;
  location?: string;
  contract?: string;
  salary?: string;
  languages?: string[];
  missions?: string[];
  requirements?: string[];
  strengths?: string[];
  gaps?: string[];
  score?: number;
  recommendation?: 'apply' | 'apply_with_care' | 'skip';
  recommendation_reason?: string;
  analyzed_at?: string;
}
export interface ReceivedOffer {
  id: string;
  origin: OfferOrigin;
  source: string;
  title: string;
  company: string;
  location: string;
  link: string;
  offer_text: string;
  received_at: string;
  seen_at: string | null;
  status: OfferStatus;
  analysis: OfferAnalysis;
  checks: Partial<Record<OfferCheck, string>>;
  target_id: string | null;
  document_id: string | null;
  application_id: string | null;
}

export type MessageKind = 'first_contact' | 'followup' | 'thanks';
export type MessageTemplates = Record<MessageKind, { subject: string; body: string }>;
