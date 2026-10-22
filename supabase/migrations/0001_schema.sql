-- Cap Emploi — schéma et sécurité par utilisateur (RLS)
-- Règle de base : chaque ligne porte user_id et n'est visible que par son propriétaire.
-- Tout vit dans le schéma cap_emploi, pour partager un projet Supabase existant sans toucher à ses tables.
-- Aucun déclencheur n'est posé sur auth.users : le profil est créé à la première connexion (ensure_profile).

create schema if not exists cap_emploi;
grant usage on schema cap_emploi to anon, authenticated, service_role;
alter default privileges in schema cap_emploi grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema cap_emploi grant all on tables to service_role;
alter default privileges in schema cap_emploi grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema cap_emploi revoke execute on functions from public;
alter default privileges in schema cap_emploi grant execute on functions to service_role;

-- ───────────────────────── Profils ─────────────────────────

create table cap_emploi.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  ui_lang text not null default 'fr' check (ui_lang in ('fr', 'en', 'de')),
  doc_lang text not null default 'fr' check (doc_lang in ('fr', 'en', 'de')),
  trade text not null default 'general',
  -- Métiers visés (plusieurs possibles) ; trade garde le premier, pour les modèles de messages.
  target_trades text[] not null default '{general}' check (cardinality(target_trades) between 1 and 13),
  -- Profil expérimenté : CV sans âge ni photo, expériences anciennes résumées, expérience présentée comme un atout.
  senior_mode boolean not null default false,
  goals jsonb not null default '{"contacts":5,"applications":3,"followups":5,"posts":1,"training":1,"network":1}',
  followup_days int not null default 7 check (followup_days between 1 and 60),
  cv_text text not null default '' check (length(cv_text) <= 60000),
  profile_data jsonb not null default '{}',
  onboarded boolean not null default false,
  consent_at timestamptz,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  created_at timestamptz not null default now()
);

alter table cap_emploi.profiles enable row level security;
create policy "profil : lecture" on cap_emploi.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profil : modification" on cap_emploi.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Le plan et le consentement ne sont modifiables que côté serveur : mise à jour limitée aux colonnes listées.
revoke update on cap_emploi.profiles from authenticated, anon;
grant update (display_name, ui_lang, doc_lang, trade, target_trades, senior_mode, goals, followup_days, cv_text, profile_data, onboarded)
  on cap_emploi.profiles to authenticated;

-- Création du profil à la première connexion (nom, langue et consentement transmis par le formulaire d'inscription).
-- Remplace un déclencheur sur auth.users, que le projet hôte partage avec d'autres applications.
create function cap_emploi.ensure_profile() returns cap_emploi.profiles
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb;
  lang text;
  row cap_emploi.profiles;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into row from cap_emploi.profiles where id = auth.uid();
  if found then return row; end if;
  select coalesce(raw_user_meta_data, '{}') into meta from auth.users where id = auth.uid();
  lang := coalesce(meta ->> 'ui_lang', 'fr');
  if lang not in ('fr', 'en', 'de') then lang := 'fr'; end if;
  insert into cap_emploi.profiles (id, display_name, ui_lang, doc_lang, consent_at)
  values (auth.uid(), coalesce(meta ->> 'display_name', ''), lang, lang, case when (meta ->> 'consent') = 'true' then now() end)
  on conflict (id) do nothing;
  select * into row from cap_emploi.profiles where id = auth.uid();
  return row;
end $$;

-- ───────────────────────── Cibles et pipeline ─────────────────────────

create table cap_emploi.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null check (length(company) between 1 and 200),
  sector text not null default '',
  priority text not null default 'B' check (priority in ('A', 'B', 'C')),
  contact_name text not null default '',
  contact_role text not null default '',
  channel text not null default 'linkedin' check (channel in ('linkedin', 'email', 'phone', 'visit', 'jobboard', 'other')),
  stage text not null default 'todo' check (stage in ('todo', 'contacted', 'followed_up', 'interview', 'offer', 'rejected')),
  last_contact_on date,
  job_url text not null default '',
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index targets_user_idx on cap_emploi.targets (user_id, stage);

alter table cap_emploi.targets enable row level security;
create policy "cibles : tout sur les siennes" on cap_emploi.targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function cap_emploi.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger targets_touch before update on cap_emploi.targets for each row execute function cap_emploi.touch_updated_at();

-- ───────────────────────── Rythme de la semaine ─────────────────────────

-- week : semaine ISO, au format 2026-W43.
create table cap_emploi.weeks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  counters jsonb not null default '{}',
  primary key (user_id, week)
);

alter table cap_emploi.weeks enable row level security;
create policy "semaines : tout sur les siennes" on cap_emploi.weeks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Ajoute delta à un compteur, sans descendre sous zéro ; renvoie les compteurs de la semaine.
create function cap_emploi.bump_counter(p_week text, p_key text, p_delta int) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if p_key not in ('contacts', 'applications', 'followups', 'posts', 'training', 'network') then
    raise exception 'Compteur inconnu : %', p_key;
  end if;
  insert into cap_emploi.weeks (user_id, week, counters)
  values (auth.uid(), p_week, jsonb_build_object(p_key, greatest(p_delta, 0)))
  on conflict (user_id, week) do update
    set counters = cap_emploi.weeks.counters
      || jsonb_build_object(p_key, greatest(coalesce((cap_emploi.weeks.counters ->> p_key)::int, 0) + p_delta, 0))
  returning counters into result;
  return result;
end $$;

-- ───────────────────────── Documents générés ─────────────────────────

create table cap_emploi.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid references cap_emploi.targets (id) on delete set null,
  company text not null default '',
  job_title text not null default '',
  lang text not null check (lang in ('fr', 'en', 'de')),
  offer_text text not null default '',
  cv text not null default '',
  letter text not null default '',
  gaps jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index documents_user_idx on cap_emploi.documents (user_id, created_at desc);

alter table cap_emploi.documents enable row level security;
create policy "documents : tout sur les siens" on cap_emploi.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Consommation IA ─────────────────────────

-- Écrite uniquement par la fonction serveur (clé de service) ; lisible par l'utilisateur.
create table cap_emploi.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  documents int not null default 0,
  extractions int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, month)
);

alter table cap_emploi.ai_usage enable row level security;
create policy "usage : lecture" on cap_emploi.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────── Modèles par métier et par langue ─────────────────────────

-- trade '*' : modèle commun à tous les métiers. kind : sectors | messages | keywords (mots-clés de recherche).
create table cap_emploi.modeles (
  trade text not null,
  lang text not null check (lang in ('fr', 'en', 'de')),
  kind text not null check (kind in ('sectors', 'messages', 'keywords')),
  content jsonb not null,
  primary key (trade, lang, kind)
);

alter table cap_emploi.modeles enable row level security;
create policy "modèles : lecture" on cap_emploi.modeles for select to anon, authenticated using (true);
grant select on cap_emploi.modeles to anon;

-- ───────────────────────── RGPD : suppression du compte ─────────────────────────

-- Supprime toutes les données Cap Emploi de l'appelant. Le compte de connexion n'est supprimé que s'il a été
-- créé par Cap Emploi (métadonnée app = cap_emploi), pour ne jamais toucher un compte de l'application hôte.
create function cap_emploi.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t text;
begin
  if uid is null then raise exception 'Non connecté'; end if;
  foreach t in array array['responses', 'applications', 'opportunities', 'digests', 'documents', 'weeks', 'targets', 'ai_usage'] loop
    if to_regclass('cap_emploi.' || t) is not null then
      execute format('delete from cap_emploi.%I where user_id = $1', t) using uid;
    end if;
  end loop;
  delete from cap_emploi.profiles where id = uid;
  delete from auth.users where id = uid and raw_user_meta_data ->> 'app' = 'cap_emploi';
end $$;

revoke execute on function cap_emploi.ensure_profile() from public, anon;
grant execute on function cap_emploi.ensure_profile() to authenticated;
revoke execute on function cap_emploi.delete_my_account() from public, anon;
grant execute on function cap_emploi.delete_my_account() to authenticated;
revoke execute on function cap_emploi.bump_counter(text, text, int) from public, anon;
grant execute on function cap_emploi.bump_counter(text, text, int) to authenticated;
