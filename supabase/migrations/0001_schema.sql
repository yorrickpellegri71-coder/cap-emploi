-- Cap Emploi — schéma et sécurité par utilisateur (RLS)
-- Règle de base : chaque ligne porte user_id et n'est visible que par son propriétaire.

-- ───────────────────────── Profils ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  ui_lang text not null default 'fr' check (ui_lang in ('fr', 'en', 'de')),
  doc_lang text not null default 'fr' check (doc_lang in ('fr', 'en', 'de')),
  trade text not null default 'general',
  goals jsonb not null default '{"contacts":5,"applications":3,"followups":5,"posts":1,"training":1,"network":1}',
  followup_days int not null default 7 check (followup_days between 1 and 60),
  cv_text text not null default '' check (length(cv_text) <= 60000),
  profile_data jsonb not null default '{}',
  onboarded boolean not null default false,
  consent_at timestamptz,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profil : lecture" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profil : modification" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Le plan et le consentement ne sont modifiables que côté serveur : mise à jour limitée aux colonnes listées.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, ui_lang, doc_lang, trade, goals, followup_days, cv_text, profile_data, onboarded)
  on public.profiles to authenticated;

-- Création automatique du profil à l'inscription (nom, langue et consentement transmis par le formulaire).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lang text := coalesce(new.raw_user_meta_data ->> 'ui_lang', 'fr');
begin
  if lang not in ('fr', 'en', 'de') then lang := 'fr'; end if;
  insert into public.profiles (id, display_name, ui_lang, doc_lang, consent_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    lang, lang,
    case when (new.raw_user_meta_data ->> 'consent') = 'true' then now() end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Cibles et pipeline ─────────────────────────

create table public.targets (
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
create index targets_user_idx on public.targets (user_id, stage);

alter table public.targets enable row level security;
create policy "cibles : tout sur les siennes" on public.targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger targets_touch before update on public.targets for each row execute function public.touch_updated_at();

-- ───────────────────────── Rythme de la semaine ─────────────────────────

-- week : semaine ISO, au format 2026-W43.
create table public.weeks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  counters jsonb not null default '{}',
  primary key (user_id, week)
);

alter table public.weeks enable row level security;
create policy "semaines : tout sur les siennes" on public.weeks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Ajoute delta à un compteur, sans descendre sous zéro ; renvoie les compteurs de la semaine.
create function public.bump_counter(p_week text, p_key text, p_delta int) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if p_key not in ('contacts', 'applications', 'followups', 'posts', 'training', 'network') then
    raise exception 'Compteur inconnu : %', p_key;
  end if;
  insert into public.weeks (user_id, week, counters)
  values (auth.uid(), p_week, jsonb_build_object(p_key, greatest(p_delta, 0)))
  on conflict (user_id, week) do update
    set counters = public.weeks.counters
      || jsonb_build_object(p_key, greatest(coalesce((public.weeks.counters ->> p_key)::int, 0) + p_delta, 0))
  returning counters into result;
  return result;
end $$;

-- ───────────────────────── Documents générés ─────────────────────────

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid references public.targets (id) on delete set null,
  company text not null default '',
  job_title text not null default '',
  lang text not null check (lang in ('fr', 'en', 'de')),
  offer_text text not null default '',
  cv text not null default '',
  letter text not null default '',
  gaps jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index documents_user_idx on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;
create policy "documents : tout sur les siens" on public.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Consommation IA ─────────────────────────

-- Écrite uniquement par la fonction serveur (clé de service) ; lisible par l'utilisateur.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  documents int not null default 0,
  extractions int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, month)
);

alter table public.ai_usage enable row level security;
create policy "usage : lecture" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────── Modèles par métier et par langue ─────────────────────────

-- trade '*' : modèle commun à tous les métiers. kind : sectors | messages.
create table public.modeles (
  trade text not null,
  lang text not null check (lang in ('fr', 'en', 'de')),
  kind text not null check (kind in ('sectors', 'messages')),
  content jsonb not null,
  primary key (trade, lang, kind)
);

alter table public.modeles enable row level security;
create policy "modèles : lecture" on public.modeles for select to anon, authenticated using (true);

-- ───────────────────────── RGPD : suppression du compte ─────────────────────────

-- Supprime le compte de l'appelant ; toutes ses données suivent par cascade.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.bump_counter(text, text, int) from public, anon;
grant execute on function public.bump_counter(text, text, int) to authenticated;
