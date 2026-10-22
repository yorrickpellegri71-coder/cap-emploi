-- Cap Emploi — historiques : « Mes candidatures » et « Réponses reçues ».

create table cap_emploi.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid references cap_emploi.targets (id) on delete set null,
  document_id uuid references cap_emploi.documents (id) on delete set null,
  opportunity_id uuid references cap_emploi.opportunities (id) on delete set null,
  applied_on date not null default current_date,
  company text not null check (length(company) between 1 and 200),
  job_title text not null default '',
  source text not null default '',
  lang text not null default 'fr' check (lang in ('fr', 'en', 'de')),
  -- Pièces envoyées : email, letter, cv, pitch.
  documents text[] not null default '{}',
  status text not null default 'sent' check (status in ('sent', 'followed_up', 'interview', 'offer', 'rejected', 'no_reply', 'withdrawn')),
  followup_on date,
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index applications_user_idx on cap_emploi.applications (user_id, applied_on desc);
alter table cap_emploi.applications enable row level security;
create policy "candidatures : tout sur les siennes" on cap_emploi.applications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger applications_touch before update on cap_emploi.applications for each row execute function cap_emploi.touch_updated_at();

create table cap_emploi.responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id uuid references cap_emploi.applications (id) on delete set null,
  target_id uuid references cap_emploi.targets (id) on delete set null,
  received_on date not null default current_date,
  company text not null check (length(company) between 1 and 200),
  job_title text not null default '',
  type text not null check (type in ('rejection', 'info_request', 'interview', 'offer', 'no_reply')),
  next_step text not null default '',
  next_step_on date,
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now()
);
create index responses_user_idx on cap_emploi.responses (user_id, received_on desc);
alter table cap_emploi.responses enable row level security;
create policy "réponses : tout sur les siennes" on cap_emploi.responses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
