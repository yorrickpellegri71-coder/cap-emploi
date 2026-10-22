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

export type MessageKind = 'first_contact' | 'followup' | 'thanks';
export type MessageTemplates = Record<MessageKind, { subject: string; body: string }>;
